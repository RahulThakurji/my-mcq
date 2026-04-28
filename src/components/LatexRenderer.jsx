import React, { useEffect, useRef } from 'react';
import katex from 'katex';
import renderMathInElement from 'katex/dist/contrib/auto-render';
import 'katex/dist/katex.min.css';

/**
 * High-performance LaTeX Renderer using KaTeX's official auto-render extension.
 * This is the most reliable way to handle mixed HTML/LaTeX content.
 */
const LatexRenderer = ({ children }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      try {
        renderMathInElement(containerRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
          ],
          throwOnError: false,
          trust: true,
          strict: false
        });
      } catch (error) {
        console.error("Auto-render Error:", error);
      }
    }
  }, [children]);

  // Use dangerouslySetInnerHTML to ensure that the highlighter's HTML spans
  // are preserved before KaTeX processes the text.
  const content = typeof children === 'string' ? children : '';

  return (
    <span 
      ref={containerRef} 
      className="latex-container"
      dangerouslySetInnerHTML={{ __html: content }} 
    />
  );
};

export default LatexRenderer;
