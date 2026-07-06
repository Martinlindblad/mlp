import Head from 'next/head';

const siteUrl = 'https://www.martin-lindblad.com';
const siteName = 'Martin Lindblad';
const defaultDescription =
  'Martin Lindblad is a Stockholm-based front-end developer focused on React, React Native, Next.js, TypeScript, and accessible user experiences.';

type SEOProps = {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
};

const SEO = ({
  title = siteName,
  description = defaultDescription,
  path = '/',
  image = '/Images/profilepicture.webp',
}: SEOProps): JSX.Element => {
  const pageTitle = title === siteName ? title : `${title} | ${siteName}`;
  const canonicalUrl = `${siteUrl}${path}`;
  const imageUrl = image.startsWith('http') ? image : `${siteUrl}${image}`;

  return (
    <Head>
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="theme-color" content="#000000" />
      <link rel="canonical" href={canonicalUrl} />
      <link rel="manifest" href="/manifest.json" />
      <link rel="icon" href="/favicon.ico" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Head>
  );
};

export default SEO;
