/** Standalone Node.js deployment; no hosted-platform runtime required. */
export default {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  experimental: {cpus: 2},
  async headers() {
    return [{source:"/(.*)",headers:[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"SAMEORIGIN"},
      {key:"Referrer-Policy",value:"same-origin"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}
    ]}];
  }
};
