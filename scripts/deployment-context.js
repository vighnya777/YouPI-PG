const HOSTING_ENV_VARS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'RENDER_EXTERNAL_URL',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_PROJECT_ID',
  'FLY_APP_NAME',
  'VERCEL',
  'DYNO',
  'HEROKU_APP_NAME',
  'K_SERVICE',
  'CLOUD_RUN_JOB',
  'WEBSITE_SITE_NAME',
  'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'DIGITALOCEAN_APP_ID',
  'REPL_ID'
];

export function isHostedDeployment(env = process.env) {
  return HOSTING_ENV_VARS.some(name => Boolean(env[name]));
}
