(root => {
  'use strict';

  const normalize = source => source
    .replace(/^layout\(std140\) uniform block_(CB\d+) \{ (\w+) CB\d+\[\d+\]; \};$/gm, 'uniform $2 $1;')
    .replace(/^uniform\s+(?:highp\s+)?(u?vec4) (CB\d+)\[\d+\];$/gm, 'uniform $1 $2;')
    .replace(/^\/\/\$\$.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  const hash = text => {
    let a = 0xdeadbeef;
    let b = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 2654435761);
      b = Math.imul(b ^ c, 1597334677);
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0') + text.length.toString(16);
  };

  const shaderKey = source => hash(normalize(source));

  if (typeof module !== 'undefined' && module.exports) module.exports = { shaderKey };
  else root.__webbloxShaderKey = shaderKey;
})(typeof self !== 'undefined' ? self : globalThis);
