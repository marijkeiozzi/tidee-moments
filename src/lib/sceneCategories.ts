// Pure "what is this photo of?" logic over the raw outputs of the two on-device models in
// sceneClassification.worker.ts — no TF, no DOM, so it's testable with hand-built fixtures.
//
// The question it answers: is this a photo OF A THING (a pot being sold, a fridge, a toaster,
// a lamp) rather than a memory? It only says yes when:
//   1. nobody is in frame — no "person" from the object detector (which, unlike face detection,
//      still sees sleeping babies, the back of a head, someone in profile or far away), and
//   2. no pet or animal, and
//   3. no food on show (a pan of dinner, a birthday cake) — kept as a maybe-memory, and
//   4. MobileNet's top-5 guesses are dominated by household objects, with little weight on
//      anything that suggests a memory (people's clothing, baby things, places, vehicles,
//      nature, food).
// Everything ambiguous stays a memory. Thresholds are tuned against labelled real photos —
// see sceneCategories.test.ts.

export interface ScenePrediction {
  index: number;
  label: string;
  probability: number;
}

export interface SceneDetection {
  label: string;
  score: number;
  area: number; // fraction of the frame the box covers, 0-1
}

export interface SceneClassification {
  // A photo of an object/appliance/product with no person or animal in it.
  isUtilityPhoto: boolean;
  label: string | null;
  confidence: number; // how much of MobileNet's top-5 weight sits on household objects, 0-1
  hasPerson: boolean;
  hasAnimal: boolean;
  // Raw model outputs, kept for diagnosis (console table) and tuning.
  top: ScenePrediction[];
  detections: SceneDetection[] | null;
}

type Category = 'animal' | 'personHint' | 'memoryThing' | 'place' | 'vehicle' | 'food' | 'nature' | 'object';

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// Clothing and accessories that are almost always being worn by someone in the photo.
const PERSON_HINT = new Set([
  399, 400, 411, 433, 439, 445, 451, 452, 457, 459, 465, 474, 501, 515, 518, 552, 560, 568, 578, 601, 608, 610, 614,
  617, 638, 639, 643, 652, 655, 667, 678, 689, 697, 715, 724, 735, 775, 793, 796, 801, 808, 824, 834, 837, 841, 842,
  869, 887, 903, 906, 981, 982, 983,
]);

// Baby things, toys and celebration — an "object" by ImageNet's reckoning, but a parent's photo
// of these is far more likely a moment than a listing. Never treated as clutter.
const MEMORY_THING = new Set([
  417, 431, 443, 470, 476, 496, 516, 520, 529, 607, 611, 645, 723, 765, 843, 850, 865,
]);

// Buildings, landmarks, streets, shops, stages — places you'd photograph on an outing.
const PLACE = new Set([
  406, 410, 415, 424, 425, 437, 442, 449, 454, 460, 467, 483, 497, 498, 500, 509, 525, 536, 538, 562, 580, 582, 624,
  634, 649, 663, 668, 682, 698, 703, 706, 716, 718, 727, 743, 755, 762, 788, 819, 821, 825, 832, 839, 853, 854, 858,
  860, 863, 873, 888, 900, 912, 915, 416, 602, 702, 738,
]);

// Cars, boats, planes, trains, bikes, rides — trip and outing photos.
const VEHICLE = new Set([
  403, 404, 405, 407, 408, 436, 444, 450, 466, 468, 472, 484, 510, 511, 547, 554, 555, 561, 565, 569, 573, 575, 576,
  586, 595, 603, 609, 612, 625, 627, 628, 654, 656, 660, 661, 665, 670, 671, 675, 690, 694, 701, 705, 717, 734, 751,
  757, 779, 780, 802, 803, 812, 814, 817, 820, 829, 833, 847, 856, 864, 866, 867, 870, 871, 874, 880, 895, 913, 914,
]);

function categoryOf(index: number): Category {
  if (index <= 397) return 'animal';
  if (PERSON_HINT.has(index)) return 'personHint';
  if (MEMORY_THING.has(index)) return 'memoryThing';
  if (PLACE.has(index)) return 'place';
  if (VEHICLE.has(index)) return 'vehicle';
  if (index === 923 || (index >= 924 && index <= 969)) return 'food'; // 923 "plate" is nearly always a plated meal
  if (index >= 970 && index <= 998) return 'nature';
  return 'object'; // 398-923 everything else, plus 999 (toilet tissue)
}

const ANIMAL_DETECTIONS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);
const FOOD_DETECTIONS = new Set(['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake']);

export const SCENE_THRESHOLDS = {
  // Object-detector confidence at which someone counts as being in the photo. Deliberately low:
  // a false "person" only means a pot photo gets kept; a missed person could lose a memory.
  personScore: 0.3,
  animalScore: 0.4,
  foodScore: 0.5,
  // Share of MobileNet's top-5 probability that must sit on household objects...
  objectMass: 0.3,
  // ...and how many times that must outweigh everything memory-like in the same top 5.
  objectDominance: 3,
};

export function summarizeScene(top: ScenePrediction[], detections: SceneDetection[] | null): SceneClassification {
  const hasPerson = (detections ?? []).some((d) => d.label === 'person' && d.score >= SCENE_THRESHOLDS.personScore);
  const detectedAnimal = (detections ?? []).some((d) => ANIMAL_DETECTIONS.has(d.label) && d.score >= SCENE_THRESHOLDS.animalScore);

  let objectMass = 0;
  let memoryMass = 0;
  let animalMass = 0;
  let topObject: ScenePrediction | null = null;
  for (const p of top) {
    const category = categoryOf(p.index);
    if (category === 'object') {
      objectMass += p.probability;
      if (!topObject) topObject = p;
    } else {
      memoryMass += p.probability;
      if (category === 'animal') animalMass += p.probability;
    }
  }
  const hasAnimal = detectedAnimal || animalMass >= 0.3;
  const hasFood = (detections ?? []).some((d) => FOOD_DETECTIONS.has(d.label) && d.score >= SCENE_THRESHOLDS.foodScore);

  // Without the person detector (it failed to load) there's no way to rule a person out, so
  // nothing is ever called "just an object" — the safe direction.
  const isUtilityPhoto =
    detections !== null &&
    !hasPerson &&
    !hasAnimal &&
    !hasFood &&
    objectMass >= SCENE_THRESHOLDS.objectMass &&
    objectMass >= SCENE_THRESHOLDS.objectDominance * memoryMass;

  return {
    isUtilityPhoto,
    label: (topObject ?? top[0])?.label.split(',')[0] ?? null,
    confidence: objectMass,
    hasPerson,
    hasAnimal,
    top,
    detections,
  };
}
