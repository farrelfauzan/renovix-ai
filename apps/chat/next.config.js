//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/next');


/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  nx: {},

  output: 'standalone',

  // @performa-ai/ui (libs/ui) ships TypeScript source, not built files.
  transpilePackages: ['@performa-ai/ui'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://cdn.renovix.id https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://www.gstatic.com https://github.com https://a.slack-edge.com https://www.notion.so https://linear.app https://brave.com https://d3s3b8zw1epdnj.cloudfront.net",
              "font-src 'self'",
              "connect-src 'self' https://api.renovix.id wss://api.renovix.id http://localhost:3000 ws://localhost:3000",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.renovix.id',
      },
    ],
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);

