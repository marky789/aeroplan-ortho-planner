import { DEFAULT_OPTIONS } from './planner.js';

// Ningbo city centre, CGCS2000 geographic coordinates; height is the map view height.
export const INITIAL_MAP_VIEW = Object.freeze({ longitude: 121.5503, latitude: 29.8738, height: 5000 });

export function createSampleMission() {
  return {
    name: '宁波城区航测',
    ring: [[121.5481,29.8755],[121.5535,29.8758],[121.5537,29.8735],
      [121.5515,29.8734],[121.5514,29.8718],[121.5478,29.8720]],
    holes: [], dock: [121.54855,29.87495], options: { ...DEFAULT_OPTIONS }, demo: true,
  };
}
