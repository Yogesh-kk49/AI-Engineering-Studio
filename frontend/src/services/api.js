import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:8000/api/",
    timeout: 300000, // 5 minutes — analysis takes time (clone + 5 services)
});

// The backend now scopes every analysis to the user that created it and
// requires an auth token on each request. This app doesn't have a login
// screen, so rather than surfacing one, we transparently provision (or
// reuse) a single local "guest" identity and attach its token to every
// request. See backend `accounts.views.GuestTokenView` for the other
// half of this.
const GUEST_TOKEN_KEY = "aiEngStudio.guestAuthToken";
let guestTokenPromise = null;

function fetchGuestToken() {
    const cached = localStorage.getItem(GUEST_TOKEN_KEY);
    if (cached) return Promise.resolve(cached);

    if (!guestTokenPromise) {
        guestTokenPromise = axios
            .post(`${api.defaults.baseURL}accounts/guest-token/`)
            .then(res => {
                const token = res.data.token;
                localStorage.setItem(GUEST_TOKEN_KEY, token);
                return token;
            })
            .catch(err => {
                // Don't cache a failed attempt — the next request should retry.
                guestTokenPromise = null;
                throw err;
            });
    }
    return guestTokenPromise;
}

api.interceptors.request.use(async (config) => {
    // Avoid an infinite loop trying to auth the token-fetch request itself.
    if (!config.url?.includes("accounts/guest-token")) {
        const token = await fetchGuestToken();
        config.headers.Authorization = `Token ${token}`;
    }
    return config;
});

export default api;