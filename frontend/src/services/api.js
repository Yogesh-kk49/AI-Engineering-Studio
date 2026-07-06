import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:8000/api/",
    timeout: 300000, // 5 minutes — analysis takes time (clone + 5 services)
});

export default api;