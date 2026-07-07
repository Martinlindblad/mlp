import React from 'react';

type LayoutProps = {
  children?: React.ReactNode;
  className?: string;
};

const Layout = ({ children, className }: LayoutProps): JSX.Element => {
  return <div className={className}>{children}</div>;
};

export default Layout;
