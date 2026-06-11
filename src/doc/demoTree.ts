/**
 * Demo board content (SPEC §3): root "Product Launch", 5 branches, 45 nodes,
 * mixed depths, one collapsed branch, two cross-links. The structure is
 * consumed by the M1 static scene and later by createDemoBoard() in M2.
 */
export interface DemoNode {
  /** stable key, also used to wire demo cross-links */
  key?: string
  text: string
  collapsed?: boolean
  /** side of the root for depth-1 branches */
  side?: 'left' | 'right'
  children?: DemoNode[]
}

export interface DemoCrossLink {
  fromKey: string
  toKey: string
  label: string
  style: 'solid' | 'dashed'
}

export const demoRoot: DemoNode = {
  text: 'Product Launch',
  children: [
    {
      text: 'Strategy',
      side: 'right',
      children: [
        {
          text: 'Positioning',
          children: [{ text: 'Premium tier' }, { text: 'Self-serve first' }],
        },
        {
          text: 'Competitive analysis',
          children: [{ text: 'Direct rivals' }, { text: 'Adjacent tools' }],
        },
        {
          key: 'pricing',
          text: 'Pricing',
          children: [{ text: 'Freemium' }, { text: 'Pro $12/mo' }, { text: 'Team $49/mo' }],
        },
      ],
    },
    {
      text: 'Marketing',
      side: 'left',
      children: [
        {
          text: 'Launch channels',
          children: [{ text: 'Product Hunt' }, { text: 'Hacker News' }, { text: 'X thread' }],
        },
        {
          text: 'Content',
          children: [
            { key: 'demo-video', text: 'Demo video' },
            { text: 'Blog series' },
            { text: 'Comparison pages' },
          ],
        },
        {
          text: 'Email sequence',
          children: [
            { text: 'Waitlist warmup' },
            { text: 'Launch day' },
            { text: 'Day-7 follow-up' },
          ],
        },
      ],
    },
    {
      text: 'Engineering',
      side: 'right',
      collapsed: true,
      children: [
        {
          text: 'Performance pass',
          children: [{ text: 'Canvas culling' }, { text: 'Layout cache' }],
        },
        {
          key: 'onboarding',
          text: 'Onboarding flow',
          children: [{ text: 'Empty state' }, { text: 'Shortcut hints' }],
        },
        {
          key: 'billing',
          text: 'Billing integration',
          children: [{ text: 'Stripe setup' }, { text: 'Usage metering' }],
        },
      ],
    },
    {
      text: 'Operations',
      side: 'right',
      children: [
        { text: 'Support runbook' },
        { text: 'Status page' },
        {
          text: 'Analytics dashboard',
          children: [{ text: 'Activation funnel' }, { text: 'Retention cohorts' }],
        },
      ],
    },
    {
      text: 'Risks',
      side: 'left',
      children: [
        { text: 'Scope creep' },
        { text: 'App-store rejection' },
        { text: 'Churn after trial' },
      ],
    },
  ],
}

export const demoCrossLinks: DemoCrossLink[] = [
  { fromKey: 'pricing', toKey: 'billing', label: 'drives', style: 'solid' },
  { fromKey: 'demo-video', toKey: 'onboarding', label: 'reuses script', style: 'dashed' },
]
