export const defaultState = {
  onboardingComplete: false, interests: [], requirements: [], dismissedRequirementIds: [],
  keywords: '', alertCadence: 'weekly', minimumTrialValue: 0,
  sources: ['official', 'deal-sites', 'newsletters'], trials: [], decisions: []
};

// Validate both imports and cloud data before allowing them to reach renderers.
export function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid plan file.');
  const state = { ...structuredClone(defaultState), ...input };
  for (const key of Object.keys(state)) if (!(key in defaultState)) delete state[key];
  const isText = (value) => typeof value === 'string' && value.length <= 20000;
  const isId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  for (const key of ['interests', 'sources', 'dismissedRequirementIds']) {
    if (!Array.isArray(state[key]) || state[key].length > 2000 || !state[key].every(isId)) throw new Error(`Invalid ${key}.`);
  }
  if (typeof state.onboardingComplete !== 'boolean' || !isText(state.keywords)
    || !['daily', 'weekly', 'instant', 'off'].includes(state.alertCadence)
    || !Number.isFinite(state.minimumTrialValue) || state.minimumTrialValue < 0) throw new Error('Invalid preferences.');
  for (const key of ['trials', 'requirements', 'decisions']) {
    if (!Array.isArray(state[key]) || state[key].length > 2000
      || !state[key].every((item) => item && isId(item.id))
      || new Set(state[key].map((item) => item.id)).size !== state[key].length) throw new Error(`Invalid ${key}.`);
  }
  for (const trial of state.trials) {
    const validDates = trial.status === 'saved'
      ? trial.startDate === '' && trial.endDate === ''
      : isDate(trial.startDate) && isDate(trial.endDate);
    if (!isText(trial.service) || !validDates
      || !Number.isFinite(trial.monthlyValue) || trial.monthlyValue < 0
      || !['saved', 'active', 'keep', 'cancel'].includes(trial.status)
      || (trial.catalogId != null && !isId(trial.catalogId))
      || (trial.goal != null && !isText(trial.goal)) || (trial.keepCriteria != null && !isText(trial.keepCriteria))
      || (trial.checks != null && (typeof trial.checks !== 'object' || Array.isArray(trial.checks)))) throw new Error('Invalid trial record.');
  }
  for (const requirement of state.requirements) {
    if (!isText(requirement.text) || !isText(requirement.preference)
      || !Number.isFinite(requirement.budget) || requirement.budget < 0
      || !Array.isArray(requirement.categories) || !requirement.categories.every(isId)
      || (requirement.facets != null && (!Array.isArray(requirement.facets) || !requirement.facets.every(isText)))) throw new Error('Invalid requirement record.');
  }
  for (const decision of state.decisions) {
    if (!isText(decision.service) || !isText(decision.reason)
      || !['keep', 'cancel'].includes(decision.choice)
      || !Number.isFinite(decision.monthlyValue) || decision.monthlyValue < 0
      || !isText(decision.decidedAt) || Number.isNaN(Date.parse(decision.decidedAt))) throw new Error('Invalid decision record.');
  }
  if (new TextEncoder().encode(JSON.stringify(state)).length > 750000) throw new Error('This plan is too large to sync. Export a backup and reduce its history.');
  return structuredClone(state);
}

export function hasPersonalData(state) {
  return ['trials', 'requirements', 'decisions', 'interests'].some((key) => state[key].length)
    || state.onboardingComplete || Boolean(state.keywords);
}

// Import missing records only. Existing account records and preferences win.
export function mergePlans(cloud, local) {
  const merged = validateState(cloud);
  const incoming = validateState(local);
  for (const key of ['trials', 'requirements', 'decisions']) {
    const ids = new Set(merged[key].map((item) => item.id));
    const catalogIds = new Set(merged.trials.map((item) => item.catalogId).filter(Boolean));
    for (const item of incoming[key]) {
      if (ids.has(item.id) || (key === 'trials' && item.catalogId && catalogIds.has(item.catalogId))) continue;
      merged[key].push(item);
      ids.add(item.id);
      if (key === 'trials' && item.catalogId) catalogIds.add(item.catalogId);
    }
  }
  if (!hasPersonalData(cloud)) {
    for (const key of Object.keys(defaultState).filter((key) => !['trials', 'requirements', 'decisions'].includes(key))) merged[key] = incoming[key];
  }
  return validateState(merged);
}
