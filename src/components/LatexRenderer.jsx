import React from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

/**
 * Renders text with LaTeX support.
 * Text inside $...$ is rendered as inline math.
 * Text inside $$...$$ is rendered as block math.
 */
const LatexRenderer = ({ children }) => {
  if (typeof children !== 'string') return children;

  // Split by block math first
  const blocks = children.split(/(\$\$.*?\$\$)/g);

  return (
    <>
      {blocks.map((block, bIdx) => {
        if (block.startsWith('$$') && block.endsWith('$$')) {
          const formula = block.substring(2, block.length - 2);
          return <BlockMath key={bIdx} math={formula} />;
        }

        // Handle inline math within the block
        const inlines = block.split(/(\$.*?\$)/g);
        return (
          <span key={bIdx}>
            {inlines.map((part, iIdx) => {
              if (part.startsWith('$') && part.endsWith('$')) {
                const formula = part.substring(1, part.length - 1);
                return <InlineMath key={iIdx} math={formula} />;
              }
              return part;
            })}
          </span>
        );
      })}
    </>
  );
};

export default LatexRenderer;
