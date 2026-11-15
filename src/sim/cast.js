// The original rival cast. Pure data: `look` doubles as the brief for portrait art
// (saved to public/portraits/<id>.png).

export const PORTRAIT_STYLE =
  'Exaggerated caricature portrait, painterly digital airbrush illustration, enormous head on a small body, ' +
  'rubbery stretched facial features, huge toothy grin, saturated colours, strong warm rim light, ' +
  'dusky purple and orange desert highway sky behind, bust shot facing the viewer, square composition, no text, no logos.';

export const PLAYER = { id: 'you', name: 'You', color: 0xd3202c, suit: 0x1d1e24, helmet: 0xf4f4f0, accent: 0xf2c21a, skill: 0, helmetArt: { style: 'flames', color: 0xd3202c, stripe: 0xf2c21a } };

export const COP = {
  id: 'cop', name: 'Officer Grady', color: 0xf4f4f0, suit: 0x1b2440, helmet: 0xf4f4f0, accent: 0x1c4fd6, weapon: 'bat',
  helmetArt: { style: 'stripes', color: 0x1b2440, stripe: 0x1c4fd6 },
};

export const CAST = [
  {
    id: 'dot', helmetArt: { style: 'star', color: 0x8e44ad, stripe: 0xd81b7a }, weapon: 'bat', aggro: 0.6, name: 'Diesel Dot', tagline: 'Seventy-one and still faster than you.',
    color: 0x8e44ad, suit: 0xb8862f, helmet: 0xcfd3d8, accent: 0x111111, skill: 0.55,
    look: 'A wiry seventy-year-old grandmother biker with a towering silver beehive hairdo, rhinestone cat-eye glasses, one gold tooth, a leopard-print scarf and a studded purple leather jacket, cackling.',
  },
  {
    id: 'tank', helmetArt: { style: 'checker', color: 0xf2c21a, stripe: 0x2e7d32 }, weapon: 'chain', aggro: 0.95, name: 'Tank Okafor', tagline: 'Brakes are for the weak.',
    color: 0x2e7d32, suit: 0x3b2f2f, helmet: 0x1c1c1c, accent: 0xf2c21a, skill: 0.65,
    look: 'A mountain of a man with a tiny pair of round sunglasses, a long braided beard threaded with steel nuts, welding goggles pushed up on a shaved head, sleeveless green denim vest, booming laugh.',
  },
  {
    id: 'viper', helmetArt: { style: 'bolt', color: 0x101820, stripe: 0x00a8a8 }, weapon: 'fist', aggro: 0.5, name: 'Viper Vasquez', tagline: "Blink and I'm gone.",
    color: 0x00a8a8, suit: 0x101820, helmet: 0x9be564, accent: 0x9be564, skill: 0.85,
    look: 'A lean sharp-chinned woman with a long teal braid over a shaved undercut, a snake tattoo coiling up her neck, a gap-toothed sideways smirk, one raised eyebrow, black racing leathers with lime piping.',
  },
  {
    id: 'sparkplug', helmetArt: { style: 'stripes', color: 0x2a4d8f, stripe: 0xff8c1a }, weapon: 'fist', aggro: 0.2, name: 'Sparkplug', tagline: "First race. What's a corner?",
    color: 0xff8c1a, suit: 0x2a4d8f, helmet: 0xffd23f, accent: 0xffffff, skill: 0.35,
    look: 'A scrawny freckled young rookie with braces, enormous ears, a too-big yellow helmet pushed back on a mop of orange hair, blowing a pink bubblegum bubble, wide terrified-but-thrilled eyes, oversized blue jacket.',
  },
  {
    id: 'baron', helmetArt: { style: 'argyle', color: 0x6b1f2a, stripe: 0x1b2a4a }, weapon: 'bat', aggro: 0.7, name: 'The Baron', tagline: 'Do try to keep up, old sport.',
    color: 0x1b2a4a, suit: 0x6b1f2a, helmet: 0xd9c9a3, accent: 0xd9c9a3, skill: 0.75,
    look: 'A pompous long-faced gentleman racer with a monocle, a gigantic waxed handlebar moustache, a vintage leather aviator cap with goggles, a silk cravat and a burgundy quilted riding coat, smug closed-lip grin.',
  },
];
