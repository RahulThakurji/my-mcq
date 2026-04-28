import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Enhanced LaTeX Renderer using a manual parsing loop for maximum reliability.
 * This avoids common split() issues with capturing groups and newlines.
 */
const LatexRenderer = ({ children }) => {
  if (typeof children !== 'string') return children;

  const parts = [];
  let lastIndex = 0;
  
  // Robust regex for block and inline math
  const regex = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g;
  
  let match;
  while ((match = regex.exec(children)) !== null) {
    // Add plain text before the match
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: children.substring(lastIndex, match.index)
      });
    }
    
    // Add the math part
    parts.push({
      type: 'math',
      content: match[0]
    });
    
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining plain text
  if (lastIndex < children.length) {
    parts.push({
      type: 'text',
      content: children.substring(lastIndex)
    });
  }

  // If no math was found, just return the original text wrapped in a span
  if (parts.length === 0) {
    return <span dangerouslySetInnerHTML={{ __html: children }} />;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'math') {
          const isBlock = part.content.startsWith('$$');
          const formula = isBlock 
            ? part.content.slice(2, -2).trim() 
            : part.content.slice(1, -1).trim();
            
          try {
            const html = katex.renderToString(formula, {
              displayMode: isBlock,
              throwOnError: false,
              trust: true,
              strict: false
            });
            
            if (isBlock) {
              return <div key={index} className="math-block" dangerouslySetInnerHTML={{ __html: html }} style={{ margin: '1rem 0' }} />;
            }
            return <span key={index} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
          } catch (e) {
            console.error("KaTeX Error:", e);
            return <code key={index}>{part.content}</code>;
          }
        }
        
        // Plain text or HTML from highlighter
        return <span key={index} dangerouslySetInnerHTML={{ __html: part.content }} />;
      })}
    </>
  );
};

export default LatexRenderer;
