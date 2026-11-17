// The people in the About page hero: the Edomotics team in Hyderabad and Bengaluru.
//
// Portraits come from the photographs Edomotics shared. `npm run media team` crops each one in
// _src/team/portraits/ to 480 × 640 (public/media/team/) and lists them in src/media-team.json.
// The hero cycles through all of them; hovering a portrait shows the person's name.
import PORTRAITS from '../media-team.json';

const BASE = `${import.meta.env.BASE_URL}media/team/`;

export const TEAM = PORTRAITS.map(({ file, name }) => ({ src: BASE + file, name }));
