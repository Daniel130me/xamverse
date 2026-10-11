/** Realistic Nigerian school context name pools and helper generators */

export const FIRST_NAMES_M = ['Daniel', 'Chukwuemeka', 'Benjamin', 'Ibrahim', 'Emeka', 'Tunde', 'Oluwaseun', 'Kabiru', 'Nnamdi', 'Yusuf', 'Adebayo', 'Ifeanyi', 'Musa', 'Obinna', 'Segun', 'Abubakar', 'Chinedu', 'Femi', 'Garba', 'Hassan', 'Ibrahim', 'Kelechi', 'Lekan', 'Muyiwa', 'Ngozi'];
export const FIRST_NAMES_F = ['Adaeze', 'Fatima', 'Grace', 'Amina', 'Kemi', 'Chiamaka', 'Ngozi', 'Blessing', 'Halima', 'Funke', 'Chioma', 'Zainab', 'Bisi', 'Ebere', 'Folake', 'Hauwa', 'Ijeoma', 'Joy', 'Laraba', 'Mariam', 'Nneka', 'Olashile', 'Rukayat', 'Simisola', 'Uche'];
export const SURNAMES = ['Okafor', 'Adeyemi', 'Nwosu', 'Ibrahim', 'Bello', 'Osaze', 'Adeleke', 'Yusuf', 'Chukwu', 'Balogun', 'Eze', 'Olawale', 'Abubakar', 'Okonkwo', 'Afolabi', 'Danjuma', 'Obi', 'Adeboye', 'Lawal', 'Ogundipe', 'Umeh', 'Sadiq', 'Ajayi', 'Nwachukwu', 'Oyelaran', 'Musa', 'Igbinedion', 'Tanko', 'Onyeka', 'Salami'];

export function randomOf<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

export function personName(rnd: () => number): { first: string; last: string; full: string } {
  const female = rnd() > 0.5;
  const first = female ? randomOf(FIRST_NAMES_F, rnd) : randomOf(FIRST_NAMES_M, rnd);
  const last = randomOf(SURNAMES, rnd);
  return { first, last, full: `${first} ${last}` };
}

export function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** deterministic pseudo-random generator (mulberry32) */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
