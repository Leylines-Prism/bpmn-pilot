// Configuration de la vérification : bpmnlint:recommended (empaqueté depuis .bpmnlintrc
// par npm run lint:pack) plus les règles maison bpmnpilot/event-triggers,
// bpmnpilot/agent-review, bpmnpilot/agent-escalation, bpmnpilot/form-data et
// bpmnpilot/gateway-branch-names, servies par le même résolveur
// sans paquet npm à part.

import packed from '../packed-lint-config.js'
import { eventTriggersRule } from './event-triggers.js'
import { agentReviewRule, agentEscalationRule } from './agent-steps.js'
import { formDataRule } from './form-data.js'
import { gatewayBranchNamesRule } from './gateway-branches.js'

const LOCAL_RULES = {
  'bpmnlint-plugin-bpmnpilot/event-triggers': eventTriggersRule,
  'bpmnlint-plugin-bpmnpilot/agent-review': agentReviewRule,
  'bpmnlint-plugin-bpmnpilot/agent-escalation': agentEscalationRule,
  'bpmnlint-plugin-bpmnpilot/form-data': formDataRule,
  'bpmnlint-plugin-bpmnpilot/gateway-branch-names': gatewayBranchNamesRule,
}

export const LOCAL_RULE_LEVELS = {
  'bpmnpilot/event-triggers': 'error',
  'bpmnpilot/agent-review': 'warn',
  'bpmnpilot/agent-escalation': 'warn',
  'bpmnpilot/form-data': 'warn',
  'bpmnpilot/gateway-branch-names': 'warn',
}

export default {
  ...packed,
  config: { ...packed.config, rules: { ...packed.config.rules, ...LOCAL_RULE_LEVELS } },
  resolver: {
    resolveRule: (pkg, name) => LOCAL_RULES[`${pkg}/${name}`] || packed.resolver.resolveRule(pkg, name),
    resolveConfig: (pkg, name) => packed.resolver.resolveConfig(pkg, name),
  },
}
