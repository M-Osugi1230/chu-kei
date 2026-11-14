/**
 * Fail-closed Netlify Forms activation.
 *
 * HTML forms are hidden by default. They are shown only after a site owner
 * confirms form delivery on the exact origin and records non-sensitive proof.
 * This prevents a successful-looking POST on an unsupported static host.
 */
const formElements = [...document.querySelectorAll('form[data-netlify="true"]')];

async function enableVerifiedForms() {
  if (formElements.length === 0) return;

  let config = null;
  try {
    const response = await fetch('./data/forms-availability-v1.json', { cache: 'no-store' });
    if (response.ok) config = await response.json();
  } catch {
    // Remain closed when offline or when deployment configuration is missing.
  }

  const configurationVerified =
    config?.schemaVersion === 1 &&
    config?.status === 'verified' &&
    config?.provider === 'netlify-forms' &&
    config?.verifiedOrigin === location.origin &&
    typeof config?.verifiedAt === 'string' &&
    /^\\d{4}-\\d{2}-\\d{2}T/.test(config.verifiedAt) &&
    typeof config?.verificationEvidence === 'string' &&
    config.verificationEvidence.trim().length > 0 &&
    Array.isArray(config?.verifiedFormNames);

  for (const form of formElements) {
    const name = form.getAttribute('name');
    const approved = configurationVerified && config.verifiedFormNames.includes(name);
    form.hidden = !approved;

    const availabilityNote = form.parentElement?.querySelector('[data-form-availability-status]');
    if (availabilityNote) availabilityNote.hidden = approved;
  }
}

void enableVerifiedForms();
