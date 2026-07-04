"""
gemini_agent.py
─────────────────────────────────────────────────────────────────────────────
Optional AI-powered review layer on top of the rule-based analyzers
(architecture/quality/security/dependencies). Entirely opt-in: if
GEMINI_API_KEY isn't set, every call here degrades to a no-op rather than
raising, so the rest of the pipeline works identically with or without it.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Keep prompts bounded — sending an entire large repo's source to an LLM is
# slow, expensive, and mostly wasted (most of it isn't relevant to a
# high-level review). This caps total source characters across every file
# included in one review call.
MAX_CONTEXT_CHARS = 40_000
MAX_CHARS_PER_FILE = 8_000


class GeminiAgent:
    """
    Usage
    ─────
        agent = GeminiAgent()
        if agent.enabled:
            result = agent.review_repository(context)
    """

    def __init__(self):
        # Lazy/guarded client init — the original version of this file
        # constructed the genai.Client() at import time with no guard,
        # which meant the entire Django process would crash on startup
        # for anyone who hasn't set GEMINI_API_KEY yet (including every
        # existing install before this feature existed). Constructing
        # lazily and catching failures means "no key configured" behaves
        # as "AI review is unavailable", not "the app won't start".
        self.enabled = bool(getattr(settings, "GEMINI_API_KEY", None))
        self._client = None
        if self.enabled:
            try:
                from google import genai
                self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
            except Exception as exc:
                logger.warning("gemini_agent.init_failed", extra={"error": str(exc)})
                self.enabled = False

    # ------------------------------------------------------------------
    # High-level: repo-wide review, structured output
    # ------------------------------------------------------------------

    def review_repository(self, context: dict) -> dict:
        """
        context = {
            "full_name": "owner/repo",
            "description": str,
            "languages": {"Python": 12345, ...},
            "composite_score": float,
            "quality_summary": str,
            "security_summary": dict,          # {severity: count}
            "top_security_findings": [ {title, severity, file, description}, ... ],
            "hotspot_files": [ {"file": "path.py", "content": "...", "reasons": "..."} ],
        }

        Returns a dict shaped for direct frontend consumption:
            {
                "available": bool,
                "quality_score": int | None,
                "summary": str,
                "security_insights": [str, ...],
                "performance_notes": [str, ...],
                "architecture_suggestions": [str, ...],
                "coding_suggestions": [str, ...],
                "error": str | None,
            }
        Never raises — any failure (missing key, network error, malformed
        model output) comes back as {"available": False, "error": "..."}
        so a flaky AI call can never take down a whole analysis run.
        """
        if not self.enabled:
            return {"available": False, "error": "GEMINI_API_KEY not configured."}

        try:
            prompt = self._build_repository_prompt(context)
            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "temperature": 0.2,  # low — this is analysis, not creative writing
                },
            )
            data = json.loads(response.text)
            data["available"] = True
            data["error"] = None
            return data
        except Exception as exc:
            logger.warning("gemini_agent.review_repository_failed", extra={"error": str(exc)})
            return {"available": False, "error": f"AI review failed: {exc}"}

    def _build_repository_prompt(self, context: dict) -> str:
        languages = ", ".join(context.get("languages", {}).keys()) or "unknown"

        findings_block = "\n".join(
            f"- [{f.get('severity', '?')}] {f.get('title', '')} ({f.get('file', '')}): {f.get('description', '')}"
            for f in context.get("top_security_findings", [])[:10]
        ) or "(none reported by static scan)"

        files_block = ""
        used = 0
        for hf in context.get("hotspot_files", []):
            content = (hf.get("content") or "")[:MAX_CHARS_PER_FILE]
            if used + len(content) > MAX_CONTEXT_CHARS:
                break
            used += len(content)
            files_block += f"\n--- {hf.get('file', 'unknown')} ({hf.get('reasons', '')}) ---\n{content}\n"

        return f"""You are a senior software architect reviewing a GitHub repository.

Repository: {context.get('full_name', 'unknown')}
Description: {context.get('description', '(none)')}
Primary languages: {languages}
Automated composite score: {context.get('composite_score', 'n/a')}/100
Automated quality summary: {context.get('quality_summary', 'n/a')}

Static security scan findings (already detected — do not repeat these verbatim, build on them):
{findings_block}

Below are the files the automated analysis flagged as needing the most attention (highest complexity/risk):
{files_block or '(no specific hotspot files were available for this repository)'}

Respond with ONLY a JSON object (no markdown, no code fences) with this exact shape:
{{
  "quality_score": <integer 0-100, your own independent assessment>,
  "summary": "<2-3 sentence plain-English executive summary>",
  "security_insights": ["<insight beyond what the static scan already found>", ...],
  "performance_notes": ["<specific performance observation>", ...],
  "architecture_suggestions": ["<specific, actionable suggestion>", ...],
  "coding_suggestions": ["<specific, actionable suggestion>", ...]
}}

Keep each list to at most 5 items. Be specific and reference actual file names or patterns you were shown — avoid generic advice that could apply to any repository."""

    # ------------------------------------------------------------------
    # Chat: multi-turn, repo-aware, capable of generating code
    # ------------------------------------------------------------------

    def chat(self, context: dict, history: list[dict], message: str) -> dict:
        """
        context — same shape assembled by the caller as review_repository,
        plus optionally "extra_files": [{"file": path, "content": str}]
        for files the caller detected the user is asking about by name.

        history — [{"role": "user"|"model", "content": str}, ...] in
        chronological order. Capped by the caller before this is called;
        this method doesn't enforce a limit itself.

        Returns {"reply": str, "error": str | None}. Never raises.
        """
        if not self.enabled:
            return {"reply": "", "error": "GEMINI_API_KEY not configured."}

        try:
            system_prompt = self._build_chat_system_prompt(context)
            contents = [{"role": "user", "parts": [{"text": system_prompt}]}]
            contents.append({"role": "model", "parts": [{"text": (
                "Understood. I've reviewed the repository context and I'm ready to answer "
                "questions, explain code, and write new or modified code for this repository."
            )}]})
            for turn in history:
                role = "model" if turn.get("role") == "model" else "user"
                content = str(turn.get("content", ""))[:MAX_CONTEXT_CHARS]
                if content:
                    contents.append({"role": role, "parts": [{"text": content}]})
            contents.append({"role": "user", "parts": [{"text": message[:MAX_CONTEXT_CHARS]}]})

            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config={"temperature": 0.4},
            )
            return {"reply": response.text, "error": None}
        except Exception as exc:
            logger.warning("gemini_agent.chat_failed", extra={"error": str(exc)})
            return {"reply": "", "error": f"Chat failed: {exc}"}

    def _build_chat_system_prompt(self, context: dict) -> str:
        languages = ", ".join(context.get("languages", {}).keys()) or "unknown"

        findings_block = "\n".join(
            f"- [{f.get('severity', '?')}] {f.get('title', '')} ({f.get('file', '')})"
            for f in context.get("top_security_findings", [])[:10]
        ) or "(none reported)"

        tree_block = "\n".join(context.get("file_paths", [])[:200]) or "(not available)"

        files_block = ""
        used = 0
        for hf in context.get("hotspot_files", []) + context.get("extra_files", []):
            content = (hf.get("content") or "")[:MAX_CHARS_PER_FILE]
            if used + len(content) > MAX_CONTEXT_CHARS:
                break
            used += len(content)
            files_block += f"\n--- {hf.get('file', 'unknown')} ---\n{content}\n"

        return f"""You are an expert AI assistant embedded in a code-analysis tool, answering questions about one specific repository and helping the user by writing code for it when asked.

Repository: {context.get('full_name', 'unknown')}
Description: {context.get('description', '(none)')}
Primary languages: {languages}
Automated composite score: {context.get('composite_score', 'n/a')}/100
Automated quality summary: {context.get('quality_summary', 'n/a')}

Known security findings from the automated scan:
{findings_block}

A partial file listing from this repository (there may be more files not shown):
{tree_block}

Contents of specific files (hotspots the automated analysis flagged, and/or files the user has referenced by name):
{files_block or '(no file contents loaded yet — if you need to see a specific file to answer accurately, ask the user for its exact path)'}

Instructions:
- Answer questions about this repository's architecture, code, dependencies, and the automated findings above using the context you were given.
- If asked to write or modify code, produce complete, correct, runnable code in a fenced code block (```language ... ```), matching the repository's existing language/style/conventions where visible in the file contents above.
- If a request needs a file's content you haven't been shown, say exactly which file path you need instead of guessing at its contents.
- Be direct and specific — reference actual file names, functions, and findings from the context rather than generic advice.
- If something is genuinely outside what you can determine from the given context, say so rather than inventing details."""



    def review_code(self, code: str) -> str:
        """Free-text review of a single code snippet. Returns an error
        message string (not an exception) if the AI is unavailable or the
        call fails, so callers can display it directly without try/except."""
        if not self.enabled:
            return "AI review unavailable: GEMINI_API_KEY not configured."

        try:
            response = self._client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"""You are a senior software architect.

Review this code.

Give:
- Quality score /100
- Security issues
- Performance problems
- Architecture improvements
- Better coding suggestions

Code:
{code[:MAX_CONTEXT_CHARS]}
""",
            )
            return response.text
        except Exception as exc:
            logger.warning("gemini_agent.review_code_failed", extra={"error": str(exc)})
            return f"AI review failed: {exc}"