import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El worker (carpeta worker/) no forma parte de la web: Next solo compila src/.
  poweredByHeader: false,
  // Lo pide «next upgrade --agent=security»: deja constancia de que esta actualización
  // se hizo por un aviso de seguridad, no por cambiar de versión mayor.
  experimental: { agentUpgrade: "security" },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
