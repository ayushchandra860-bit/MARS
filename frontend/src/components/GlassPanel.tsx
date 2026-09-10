import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  auroraBorder?: boolean;
  style?: React.CSSProperties;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  auroraBorder = false,
  style = {},
}) => {
  return (
    <div
      className={`glass-panel ${auroraBorder ? 'aurora-border' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
};
