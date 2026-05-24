import React from 'react';
import * as Lucide from 'lucide-react';

// Hardcoded bank of exactly 50 verified medical-themed icons from lucide-react
export const MEDICAL_ICONS = [
  'Activity', 'Heart', 'HeartPulse', 'Brain', 'Dna', 'Stethoscope', 'Pill', 'Syringe', 'Thermometer', 
  'BriefcaseMedical', 'Hospital', 'Microscope', 'Bone', 'Eye', 'Apple', 'Baby', 'Biohazard', 'Radiation', 
  'Skull', 'Clipboard', 'FlaskConical', 'FlaskRound', 'Ambulance', 'BrainCircuit', 'Droplet', 'Droplets', 
  'Tablets', 'Sprout', 'HeartCrack', 'Bed', 'Scale', 'ShieldAlert', 'HeartHandshake', 'HelpingHand', 
  'FileHeart', 'FolderHeart', 'ShieldPlus', 'HeartOff', 'UserPlus', 'FileText', 'ClipboardCheck', 'Award', 
  'Bell', 'Sparkles', 'Flame', 'Weight', 'Glasses', 'PlusCircle', 'UserCheck', 'Shield'
];

interface MedicalIconProps {
  name: string | null | undefined;
  className?: string;
  size?: number;
}

// Highly optimized dynamic renderer for Lucide icons
export const MedicalIcon: React.FC<MedicalIconProps> = ({ name, className, size }) => {
  if (!name) return null;
  const IconComponent = (Lucide as any)[name];
  if (!IconComponent) {
    // Graceful fallback to Activity icon if name is invalid
    const Fallback = Lucide.Activity;
    return <Fallback className={className} size={size} />;
  }
  return <IconComponent className={className} size={size} />;
};

// Generates a grid of 20 unique icons: 1 target icon and 19 random distractors
export const generateIconGrid = (correctIcon: string | null | undefined): string[] => {
  if (!correctIcon) return [];
  
  // Extract distractors (all icons except the correct one)
  const distractors = MEDICAL_ICONS.filter(icon => icon !== correctIcon);
  
  // Shuffle distractors and grab 19
  const shuffledDistractors = [...distractors].sort(() => Math.random() - 0.5);
  const selectedDistractors = shuffledDistractors.slice(0, 19);
  
  // Combine correct icon and the 19 distractors
  const grid = [correctIcon, ...selectedDistractors];
  
  // Final shuffle of all 20 icons
  return grid.sort(() => Math.random() - 0.5);
};
