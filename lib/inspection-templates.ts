/**
 * Inspection checklists (automotive), one per package.
 *
 * Owner, 2026-10-05: "Lets go with a quick check for now with options to
 * adjust things as necessary." The Quick Check below is the research's
 * package A (about an hour at the automotive rate). Starting an inspection
 * COPIES these items into inspection_items (0067), so editing this file later
 * never changes a report already made. To change the checklist, edit it here;
 * to change one report, add, skip or remove items on that report.
 *
 * Owner, 2026-11-27: "I need you to build an inspection sheet for Airlift
 * Northwest. I want a sheet that has general items for fluid levels, leaks,
 * conditions, etc. but I specifically want to make sure it has brake pad
 * life, tire life and a chart to locate and acknowledge body damage." That is
 * the second package, 'fleet' (0073): a vehicle condition sheet for a car the
 * shop looks after, not one somebody is thinking of buying. Its three asked-for
 * pieces are measures: 'pads' (mm at each wheel), 'tread' (32nds at each tire)
 * and 'damage' (marks on the chart, components/DamageChart).
 */

export type InspectionPackage = 'quick' | 'fleet'
export type MeasureKind = 'tread' | 'battery' | 'pads' | 'damage'

export interface TemplateItem {
  label: string
  /** What it takes (owner-facing only). */
  needs?: 'lift' | 'scan tool' | 'road test' | 'battery tester' | 'tread gauge' | 'brake gauge' | 'NHTSA website'
  measure?: MeasureKind
}

export interface TemplateSection {
  section: string
  items: TemplateItem[]
}

export interface InspectionTemplate {
  package: InspectionPackage
  name: string
  /** The document's title on the report and in its file name. */
  docType: string
  /** The owner's short word for one: "Pre-buy R001", "Inspection R002". */
  short: string
  /** Who the report is written to, mid-sentence. */
  reader: string
  /** Pre-buy only: the seller's name and the recall lookup. */
  sellerField: boolean
  recallsField: boolean
  /** Starting labor for the job, in hours (the owner adjusts it on the job). */
  hours: number
  sections: TemplateSection[]
  /** Printed on every report under "Not checked": what this package never covers. */
  notIncluded: string[]
}

export const QUICK_CHECK: InspectionTemplate = {
  package: 'quick',
  name: 'Quick Check',
  docType: 'Pre-Purchase Inspection',
  short: 'Pre-buy',
  reader: 'buyer',
  sellerField: true,
  recallsField: true,
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

/**
 * The Vehicle Inspection: the condition of a vehicle the shop looks after.
 * Body damage comes first because the walk-around happens first, when the
 * vehicle arrives and before anything is touched.
 */
export const VEHICLE_INSPECTION: InspectionTemplate = {
  package: 'fleet',
  name: 'Vehicle Inspection',
  docType: 'Vehicle Inspection',
  short: 'Inspection',
  reader: 'customer',
  sellerField: false,
  recallsField: false,
  hours: 1,
  sections: [
    {
      section: 'Body damage',
      items: [{ label: 'Body damage, marked on the chart', measure: 'damage' }],
    },
    {
      section: 'Fluid levels',
      items: [
        { label: 'Engine oil: level and condition' },
        { label: 'Coolant: level and condition' },
        { label: 'Brake fluid: level and condition' },
        { label: 'Transmission fluid' },
        { label: 'Power steering fluid' },
        { label: 'Washer fluid' },
      ],
    },
    {
      section: 'Leaks',
      items: [
        { label: 'Engine bay: oil, coolant or fuel' },
        { label: 'Under the vehicle: engine and transmission', needs: 'lift' },
        { label: 'Axle seals, differential and transfer case', needs: 'lift' },
        { label: 'Shocks and struts', needs: 'lift' },
        { label: 'Exhaust', needs: 'lift' },
      ],
    },
    {
      section: 'Under the hood',
      items: [
        { label: 'Battery test', needs: 'battery tester', measure: 'battery' },
        { label: 'Battery terminals and hold-down' },
        { label: 'Drive belts' },
        { label: 'Hoses and clamps' },
        { label: 'Engine air filter' },
        { label: 'Cabin air filter' },
      ],
    },
    {
      section: 'Brakes',
      items: [
        { label: 'Brake pad life, each wheel', needs: 'brake gauge', measure: 'pads' },
        { label: 'Rotors and drums: scoring, rust, lip' },
        { label: 'Brake lines and hoses', needs: 'lift' },
        { label: 'Parking brake holds' },
      ],
    },
    {
      section: 'Tires and wheels',
      items: [
        { label: 'Tire life: tread depth, each tire and the spare', needs: 'tread gauge', measure: 'tread' },
        { label: 'Tire pressures set to the door placard' },
        { label: 'Tire condition: sidewalls, uneven wear, age' },
        { label: 'Wheels and lug nuts' },
      ],
    },
    {
      section: 'Steering and suspension',
      items: [
        { label: 'Ball joints, tie rods and bushings', needs: 'lift' },
        { label: 'CV axles and boots', needs: 'lift' },
        { label: 'Wheel bearings: play or noise', needs: 'lift' },
      ],
    },
    {
      section: 'Lights, glass and wipers',
      items: [
        { label: 'Headlights, brake lights, turn signals, reverse and hazards' },
        { label: 'Windshield and glass: cracks and chips' },
        { label: 'Wiper blades and washers' },
        { label: 'Mirrors and horn' },
      ],
    },
    {
      section: 'Inside',
      items: [
        { label: 'Warning lights on the dash' },
        { label: 'Seat belts' },
        { label: 'Heater, defroster and A/C' },
        { label: 'Doors, locks and windows' },
      ],
    },
    {
      section: 'Road test',
      items: [
        { label: 'Brakes: firm pedal, stops straight', needs: 'road test' },
        { label: 'Steering: pull, wander or play', needs: 'road test' },
        { label: 'Noises, vibration and shifting', needs: 'road test' },
      ],
    },
  ],
  notIncluded: [
    'A computer scan for stored codes',
    'Wheel alignment measurement',
    'Anything that needs parts taken apart',
  ],
}

export const TEMPLATES: Record<InspectionPackage, InspectionTemplate> = {
  quick: QUICK_CHECK,
  fleet: VEHICLE_INSPECTION,
}

/** A report's template; a package this build does not know reads as the Quick Check. */
export function templateFor(pkg: string | null | undefined): InspectionTemplate {
  return TEMPLATES[(pkg as InspectionPackage) ?? 'quick'] ?? QUICK_CHECK
}
