export type ComponentProps = React.PropsWithChildren<{
  index: any;
  value: any;
}> &
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
