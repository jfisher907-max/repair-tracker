import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Version skew is what makes an installed app go dead after a deploy: the
  // phone is holding yesterday's HTML, the router intercepts a tap, asks the
  // server for a chunk that no longer exists, and the click quietly does
  // nothing — the press animation is pure CSS, so it still fires and the app
  // looks alive while going nowhere.
  //
  // Stamping the build lets Next SEE that mismatch and fall back to a real
  // page load instead of swallowing the tap.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
};

export default nextConfig;
