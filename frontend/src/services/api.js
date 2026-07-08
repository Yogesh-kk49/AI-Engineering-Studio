import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:8000/api/",
    timeout: 300000, // 5 minutes — analysis takes time (clone + 5 services)
});

// Every /api/ endpoint (aside from the OTP login endpoints themselves)
// requires a valid per-user auth token — see backend accounts.views. The
// token is issued once at login (VerifyOTPView) and just re-attached to
// every request from here on; AuthContext is what actually owns the
// login/logout lifecycle, this module just reads what it wrote.
export const TOKEN_KEY = "aiEngStudio.authToken";
export const EMAIL_KEY = "aiEngStudio.authEmail";

api.interceptors.request.use((config) => {
    const isAuthEndpoint = config.url?.includes("accounts/otp/");
    if (!isAuthEndpoint) {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
            config.headers.Authorization = `Token ${token}`;
        }
    }
    return config;
});

// A 401 here means the saved token was revoked/expired server-side (e.g.
// logged out elsewhere, or the backend's token table was reset). Clear
// the stale token and bounce to the login page rather than leaving the
// user staring at a dashboard full of failed requests.
api.interceptors.response.use(
    (response) => response,
    (err) => {
        if (err.response?.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(EMAIL_KEY);
            if (!window.location.pathname.startsWith("/login")) {
                window.location.assign("/login");
            }
        }
        return Promise.reject(err);
    }
);

export default api;