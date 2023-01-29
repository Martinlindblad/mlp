import React from 'react';

interface Props {
  height?: number;
  color?: string;
  strokeWidth?: number;
}

const CenterPoint: React.FC<Props> = ({
  height = 200,
  color = '#000',
  strokeWidth = 4,
}) => {
  return (
    <svg width="100%" height={height}>
      <circle cx={height / 2} cy={height / 2} r={height / 20} fill={color} />
      <line
        x1={height / 2}
        y1={height / 2}
        x2={height / 2}
        y2={height}
        stroke={color}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
};

export default CenterPoint;
