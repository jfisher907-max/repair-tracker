/**
 * Pre-purchase inspection checklists (automotive), one per package.
 *
 * Owner, 2026-10-05: "Lets go with a quick check for now with options to
 * adjust things as necessary." The Quick Check below is the research's
 * package A (about an hour at the automotive rate). Starting an inspection
 * COPIES these items into inspection_items (0067), so editing this file later
 * never changes a report already made. To change the checklist, edit it here;
 * to change one report, add, skip or remove items on that report.
 */

export type InspectionPackage = 'quick'
export type MeasureKind = 'tread' | 'battery'

export interface TemplateItem {
  label: string
  /** What it takes (owner-facing only). */
  needs?: 'lift' | 'scan tool' | 'road test' | 'battery tester' | 'tread gauge' | 'NHTSA website'
  measure?: MeasureKind
}

export interface TemplateSection {
  section: string
  items: TemplateItem[]
}

export interface InspectionTemplate {
  package: InspectionPackage
  name: string
  /** Starting labor for the job, in hours (the owner adjusts it on the job). */
  hours: number
  sections: TemplateSection[]
  /** Printed on every report under "Not checked": what this package never covers. */
  notIncluded: string[]
}

export const QUICK_CHECK: InspectionTemplate = {
  package: 'quick',
  name: 'Quick Check',
  hours: 1,
  sections: [
    {
      section: 'Vehicle and paperwork',
      items: [
        { label: 'VIN on the dash matches the title or registration' },
        { label: 'Keys and fobs that come with the car' },
        { label: 'Open safety recalls by VIN', needs: 'NHTSA website' },
      ],
    },
    {
      section: 'Start-up and computer scan',
      items: [
        { label: 'Warning lights come on at key-on and go out once running' },
        { label: 'Trouble codes: engine, transmission, ABS, airbag', needs: 'scan tool' },
        { label: 'Readiness monitors (several “not ready” can mean codes were just cleared)', needs: 'scan tool' },
        { label: 'Battery test', needs: 'battery tester', measure: 'battery' },
      ],
    },
    {
      section: 'Under the hood',
      items: [
        { label: 'Engine oil level and condition, under the fill cap' },
        { label: 'Coolant level and condition' },
        { label: 'Brake, power steering and transmission fluids' },
        { label: 'Drive belts and hoses' },
        { label: 'Leaks in the engine bay' },
      ],
    },
    {
      section: 'Underneath (on the lift, wheels on)',
      items: [
        { label: 'Frame rails, rockers and floor: damage or rust-through', needs: 'lift' },
        { label: 'Brake and fuel lines: corrosion', needs: 'lift' },
        { label: 'Leaks from engine, transmission and differentials', needs: 'lift' },
        { label: 'Exhaust and catalytic converter', needs: 'lift' },
      ],
    },
    {
      section: 'Tires and brakes (wheels on)',
      items: [
        { label: 'Tread depth, each tire and the spare', needs: 'tread gauge', measure: 'tread' },
        { label: 'Tires match; uneven wear' },
        { label: 'Brake pads seen through the wheel (a look, not measured)' },
      ],
    },
    {
      section: 'Body, glass and lights',
      items: [
        { label: 'Panel gaps, mismatched paint, rust bubbles' },
        { label: 'Windshield cracks and chips' },
        { label: 'Exterior lights and lenses' },
      ],
    },
    {
      section: 'Inside',
      items: [
        { label: 'Heater, defroster, A/C and blower' },
        { label: 'Windows, locks, wipers, washers and horn' },
        { label: 'Seat belts; smells (smoke, musty, heavy air freshener)' },
      ],
    },
    {
      section: 'Short road test',
      items: [
        { label: 'Starts easily, idles smooth, pulls without hesitation', needs: 'road test' },
        { label: 'Transmission shifts smoothly', needs: 'road test' },
        { label: 'Brakes: firm pedal, stops straight', needs: 'road test' },
        { label: 'Steering pull, clunks or noises over bumps', needs: 'road test' },
      ],
    },
  ],
  notIncluded: [
    'Brakes measured with the wheels off',
    'Paint-thickness readings',
    'Compression test',
    'Vehicle history report',
    'Anything that needs parts taken apart',
  ],
}

export const TEMPLATES: Record<InspectionPackage, InspectionTemplate> = { quick: QUICK_CHECK }
