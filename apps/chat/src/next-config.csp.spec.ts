/**
 * RNX-353 AC4: the chat CSP's `img-src`, read from the real `next.config.js` (only the Nx wrapper is replaced).
 * The dev bucket host is built from S3_BUCKET and S3_REGION, and only outside a production build.
 */
jest.mock('@nx/next', () => ({
  composePlugins:
    () =>
    (config: unknown): unknown =>
      config,
  withNx: (config: unknown): unknown => config,
}));

type HeaderRule = { headers: { key: string; value: string }[] };
type ChatNextConfig = { headers: () => Promise<HeaderRule[]> };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatNextConfig: ChatNextConfig = require('../next.config.js');

const TEST_BUCKET_HOST = 'https://test-bucket.s3.test-region.amazonaws.com';

async function readImgSources(env: Record<string, string>): Promise<string[]> {
  jest.replaceProperty(process, 'env', env as NodeJS.ProcessEnv);
  const rules = await chatNextConfig.headers();
  const policy = rules.flatMap((rule) => rule.headers).find((header) => header.key === 'Content-Security-Policy');
  const directive = policy?.value.split('; ').find((part) => part.startsWith('img-src '));
  return directive?.split(' ').slice(1) ?? [];
}

describe('chat CSP img-src (RNX-353)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows the dev bucket host built from S3_BUCKET and S3_REGION in development, and not the old MinIO host', async () => {
    const actualSources = await readImgSources({ NODE_ENV: 'development', S3_BUCKET: 'test-bucket', S3_REGION: 'test-region' });
    expect(actualSources).toContain(TEST_BUCKET_HOST);
    expect(actualSources).not.toContain('http://localhost:9000');
  });

  it('does not allow the dev bucket host in a production build', async () => {
    const actualSources = await readImgSources({ NODE_ENV: 'production', S3_BUCKET: 'test-bucket', S3_REGION: 'test-region' });
    expect(actualSources).not.toContain(TEST_BUCKET_HOST);
    expect(actualSources.filter((source) => source.includes('amazonaws.com'))).toEqual([]);
    expect(actualSources).not.toContain('http://localhost:9000');
  });

  it('adds no S3 host in development when S3_REGION is missing', async () => {
    const actualSources = await readImgSources({ NODE_ENV: 'development', S3_BUCKET: 'test-bucket' });
    expect(actualSources.filter((source) => source.includes('amazonaws.com'))).toEqual([]);
  });

  it('adds no S3 host in development when S3_BUCKET is missing', async () => {
    const actualSources = await readImgSources({ NODE_ENV: 'development', S3_REGION: 'test-region' });
    expect(actualSources.filter((source) => source.includes('amazonaws.com'))).toEqual([]);
  });

  it('keeps every other img-src entry the same in development and production', async () => {
    const developmentSources = await readImgSources({ NODE_ENV: 'development', S3_BUCKET: 'test-bucket', S3_REGION: 'test-region' });
    const productionSources = await readImgSources({ NODE_ENV: 'production', S3_BUCKET: 'test-bucket', S3_REGION: 'test-region' });
    expect(developmentSources.filter((source) => source !== TEST_BUCKET_HOST)).toEqual(productionSources);
    expect(productionSources).toContain('https://cdn.renovix.id');
  });
});
