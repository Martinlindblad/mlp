import Layout from './Layout';

const PageLayoutContainer = ({ children }: { children: React.ReactNode }) => {
  return (
    <Layout className="bg-gray-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      {children}
    </Layout>
  );
};

export default PageLayoutContainer;
