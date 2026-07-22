import * as p from '@clack/prompts';
import chalk from 'chalk';
import { saveConfig } from './config.js';
import { fetchModels } from './models.js';
import { getProvider, getProviderChoices } from './providers.js';
import { createSpinner, typewriter } from './shimmer.js';

export async function runProviderSetup(opts) {
  console.log();
  await typewriter('Welcome to vexra!', { color: [54, 208, 208], bold: true, intervalMs: 30 });
  console.log(chalk.dim("  Let's set up your AI provider.\n"));

  const providerId = await p.select({
    message: 'Choose a provider',
    options: getProviderChoices(),
  });
  if (p.isCancel(providerId)) {
    console.log(chalk.dim('\n  Setup cancelled. Exiting.\n'));
    process.exit(0);
  }

  const provider = getProvider(providerId);
  let baseUrl = provider.baseUrl;
  let model = provider.defaultModel;

  if (providerId === 'custom') {
    const customUrl = await p.text({
      message: 'API base URL (OpenAI-compatible)',
      placeholder: 'https://your-api.com/v1',
      validate: (v) => {
        if (!v.trim()) return 'URL is required';
        try { new URL(v); } catch { return 'Must be a valid URL'; }
      },
    });
    if (p.isCancel(customUrl)) {
      console.log(chalk.dim('\n  Setup cancelled. Exiting.\n'));
      process.exit(0);
    }
    baseUrl = customUrl.trim().replace(/\/+$/, '');
  }

  if (provider.keyUrl) {
    console.log(chalk.dim(`  Get your key at: `) + chalk.underline.blue(provider.keyUrl));
  }

  const apiKey = await p.password({
    message: `Enter your ${provider.name} API key`,
    placeholder: provider.keyHint,
    validate: (v) => {
      if (!v.trim()) return 'API key is required';
      if (provider.keyPrefix && !v.trim().startsWith(provider.keyPrefix)) {
        return `Key should start with "${provider.keyPrefix}"`;
      }
    },
  });
  if (p.isCancel(apiKey)) {
    console.log(chalk.dim('\n  Setup cancelled. Exiting.\n'));
    process.exit(0);
  }

  opts.apiKey = apiKey.trim();
  opts.baseUrl = baseUrl;

  const spinner = createSpinner('Fetching models...', { style: 'dots', color: [54, 208, 208] });
  spinner.start();

  let models = [];
  try {
    models = await fetchModels(baseUrl, opts.apiKey);
    spinner.stop();
  } catch {
    spinner.stop();
    p.log.warn('Could not fetch models. You can set one manually.');
  }

  if (models.length > 0) {
    const choices = models.slice(0, 50).map(m => ({
      value: m.id,
      label: m.id,
      hint: m.contextLength ? `${(m.contextLength / 1000).toFixed(0)}k ctx` : '',
    }));

    const selected = await p.select({
      message: 'Pick a model',
      options: choices,
    });
    if (p.isCancel(selected)) {
      model = provider.defaultModel || models[0].id;
    } else {
      model = selected;
    }
  } else if (providerId === 'custom') {
    const customModel = await p.text({
      message: 'Model ID',
      placeholder: 'gpt-4o',
      validate: (v) => { if (!v.trim()) return 'Model ID is required'; },
    });
    if (p.isCancel(customModel)) {
      model = 'gpt-4o';
    } else {
      model = customModel.trim();
    }
  }

  opts.model = model;

  const saved = saveConfig({
    provider: providerId,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: opts.model,
  });

  if (saved) {
    p.log.success(`Saved to ~/.vexra/config.json`);
  } else {
    p.log.warn('Could not save config file. Settings will only apply this session.');
  }

  console.log();
  p.log.success(`${chalk.bold(provider.name)} configured with ${chalk.bold.hex('#36D0D0')(model)}`);
  console.log();
}
