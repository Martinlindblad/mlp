export type ComponentProps = React.PropsWithChildren<{
  index: unknown;
  value: unknown;
}> &
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
