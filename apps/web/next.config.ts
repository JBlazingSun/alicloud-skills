import type { NextConfig } from 'next';

const extraDevOrigin = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim();
const desktopEmbed = process.env.NEXT_DESKTOP_EMBED === '1';

const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix: desktopEmbed ? './' : undefined,
  allowedDevOrigins: [
    '127.0.0.1:10111',
    'localhost:10111',
    '192.168.31.246:10111',
    ...(extraDevOrigin ? [extraDevOrigin] : []),
  ],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
