// Course definitions. Pure data. `posts` are police posts as fractions of the race distance.
export const COURSES = {
  country: {
    id: 'country', name: 'PINE VALLEY', blurb: 'Open country road',
    seed: 11, length: 6400, theme: 'country', posts: [0.3, 0.64],
  },
  town: {
    id: 'town', name: 'RIVET TOWN', blurb: 'Streets, shops and homes · heavy police',
    seed: 23, length: 6000, theme: 'town', hills: 0.3, flat: 62, posts: [0.12, 0.33, 0.55, 0.78],
  },
};
export const COURSE_IDS = Object.keys(COURSES);
export const MAX_COPS = 4;
