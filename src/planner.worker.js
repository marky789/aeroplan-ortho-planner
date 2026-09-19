import { planMission } from './planner.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, plan: planMission(data.ring, data.options, data.holes) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message || '航线计算失败' }); }
};
