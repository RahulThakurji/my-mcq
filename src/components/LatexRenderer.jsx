import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Bulletproof LaTeX Renderer.
 * Manually parses math delimiters and replaces them with KaTeX-rendered HTML
 * before inserting into the DOM. This ensures perfect rendering even in
 * complex React 19 environments with dynamic content.
 */
const LatexRenderer = ({ children }) => {
  const renderedHTML = useMemo(() => {
    if (typeof children !== 'string') return children;

    // We split the string by math delimiters but keep the delimiters in the array
    const parts = children.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
    
    return parts.map(part => {
      if (!part) return "";

      // Block Math match
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const formula = part.slice(2, -2).trim();
        try {
          return katex.renderToString(formula, {
            displayMode: true,
            throwOnError: false,
            trust: true
          });
        } catch (e) {
          console.error("KaTeX Error:", e);
          return part;
        }
      }

      // Inline Math match
      if (part.startsWith('$') && part.endsWith('$')) {
        const formula = part.slice(1, -1).trim();
        try {
          return katex.renderToString(formula, {
            displayMode: false,
            throwOnError: false,
            trust: true
          });
        } catch (e) {
          console.error("KaTeX Error:", e);
          return part;
        }
      }

      // Plain text (which might contain highlight spans)
      return part;
    }).join("");
  }, [children]);

  if (typeof children !== 'string') return children;

  return (
    <span 
      className="latex-rendered-content"
      dangerouslySetInnerHTML={{ __html: renderedHTML }} 
    />
  );
};

export default LatexRenderer;
