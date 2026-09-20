/** Pinhole rays on the horizontal plane through the sampled ground point.
 * Angles are the user's approximate 4D model, not DJI firmware parameters.
 * Local axes are right/east, forward/north, up; yaw clockwise, pitch from horizon.
 */
export function footprintOffsets(camera, altitude, pitchDeg, yawDeg) {
  const rad = Math.PI / 180, pitch = pitchDeg * rad, yaw = yawDeg * rad;
  const scale = 2 * Math.tan(camera.diagonalFov * rad / 2) / Math.hypot(camera.width, camera.height);
  const tx = scale * camera.width / 2, ty = scale * camera.height / 2;
  const forward = [Math.sin(yaw)*Math.cos(pitch), Math.cos(yaw)*Math.cos(pitch), Math.sin(pitch)];
  const right = [Math.cos(yaw), -Math.sin(yaw), 0];
  const up = [-Math.sin(yaw)*Math.sin(pitch), -Math.cos(yaw)*Math.sin(pitch), Math.cos(pitch)];
  const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    const ray=forward.map((v,i)=>v+x*tx*right[i]+y*ty*up[i]);
    if(ray[2]>=-1e-8)throw new Error('相机足迹触及地平线，无法计算有限覆盖。');
    return [-altitude*ray[0]/ray[2], -altitude*ray[1]/ray[2]];
  });
  return { corners, areaM2: Math.abs(corners.reduce((s,p,i)=>{const q=corners[(i+1)%4];return s+p[0]*q[1]-q[0]*p[1];},0))/2 };
}
export function createCaptureModel(camera, settings) {
  const smart=settings.captureMode==='smartOrtho';
  const poses=smart?[['left',settings.smartPitch,-settings.smartYaw],['nadir',-90,0],['right',settings.smartPitch,settings.smartYaw]]:[['nadir',-90,0]];
  return {
    mode: settings.captureMode, poseSource: smart?'user-approximation':'nadir',
    surfaceModel:'horizontal-plane-at-sampled-terrain',
    spacingBasis:'nadir-footprint', nativeTiming:null, executionVerified:false,
    views:poses.map(([name,pitch,yawOffset])=>({name,pitch,yawOffset,roll:0,...footprintOffsets(camera,settings.altitude,pitch,yawOffset)})),
  };
}
