// The people in the About page hero.
//
// These are TEMPORARY placeholder portraits from Unsplash (free to use under the Unsplash
// License, https://unsplash.com/license). They are not Edomotics staff.
//
// To use real team photographs:
//   1. Put portraits in public/media/team/ — portrait 3:4, at least 480 × 640, faces roughly centred.
//   2. Replace each entry below with { src: '/media/team/<file>.webp', name: '…', role: '…' }.
//   3. Add or remove entries freely; the hero cycles through however many there are (8+ looks best).

const unsplash = (id) => `https://images.unsplash.com/${id}?w=480&h=640&fit=crop&crop=faces&q=72&auto=format`;

const PLACEHOLDER = { name: '[NEEDS COPY: name]', role: '[NEEDS COPY: role]', placeholder: true };

export const TEAM = [
  { src: unsplash('photo-1649433658557-54cf58577c68'), ...PLACEHOLDER },
  { src: unsplash('photo-1778692258270-bc0e80e975c0'), ...PLACEHOLDER },
  { src: unsplash('photo-1573496359142-b8d87734a5a2'), ...PLACEHOLDER },
  { src: unsplash('photo-1782323709687-43675cbddd46'), ...PLACEHOLDER },
  { src: unsplash('photo-1573497019940-1c28c88b4f3e'), ...PLACEHOLDER },
  { src: unsplash('photo-1775342369616-f23a25e866d3'), ...PLACEHOLDER },
  { src: unsplash('photo-1745434159123-5b99b94206ca'), ...PLACEHOLDER },
  { src: unsplash('photo-1600878459138-e1123b37cb30'), ...PLACEHOLDER },
  { src: unsplash('photo-1573497161161-c3e73707e25c'), ...PLACEHOLDER },
  { src: unsplash('photo-1752952952773-80378cefc23d'), ...PLACEHOLDER },
  { src: unsplash('photo-1745434159123-4908d0b9df94'), ...PLACEHOLDER },
  { src: unsplash('photo-1737660213008-f5ae44b492da'), ...PLACEHOLDER },
];
