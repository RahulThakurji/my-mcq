import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Industrial-strength LaTeX Renderer using the core KaTeX library.
 * This approach is more reliable than react-katex wrappers in React 19.
 */
const LatexRenderer = ({ children }) => {
  if (typeof children !== 'string') return children;

  // Split by math delimiters, preserving the delimiters in the resulting array
  const segments = children.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
  
  return (
    <>
      {segments.map((segment, index) => {
        if (!segment) return null;

        // Block Math match ($$...$$)
        if (segment.startsWith('$$') && segment.endsWith('$$')) {
          const formula = segment.slice(2, -2).trim();
          try {
            const html = katex.renderToString(formula, {
              displayMode: true,
              throwOnError: false
            });
            return <div key={index} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch (e) {
            console.error("KaTeX Block Error:", e);
            return <code key={index}>{segment}</code>;
          }
        }

        // Inline Math match ($...$)
        if (segment.startsWith('$') && segment.endsWith('$')) {
          const formula = segment.slice(1, -1).trim();
          try {
            const html = katex.renderToString(formula, {
              displayMode: false,
              throwOnError: false
            });
            return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
          } catch (e) {
            console.error("KaTeX Inline Error:", e);
            return <span key={index}><code>{segment}</code></span>;
          }
        }

        // Plain text or HTML content (like highlights)
        return <span key={index} dangerouslySetInnerHTML={{ __html: segment }} />;
      })}
    </>
  );
};

export default LatexRenderer;
