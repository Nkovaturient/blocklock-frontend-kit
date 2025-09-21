/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
  },
  images: {
    remotePatterns: [],
    unoptimized: true,
  },
  webpack: (config: any) => {
    // Ensure node:crypto is treated as external to avoid bundling errors
    config.externals = config.externals || [];
    config.externals.push({ 'node:crypto': 'crypto' });
    return config;
  },
};

export default nextConfig;
