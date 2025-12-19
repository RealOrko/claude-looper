/**
 * Goal Progress Icons
 * Assembles constants with React icon components
 */
import { CheckCircle2, XCircle, AlertTriangle, Activity, Pause, Play, GitBranch, FastForward, Award } from 'lucide-react';
import { confidenceLevelData, statusConfigData } from './constants.js';

const iconMap = {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Pause,
  Play,
  GitBranch,
  FastForward,
  Award,
};

/** Confidence levels with icon components */
export const confidenceLevels = Object.fromEntries(
  Object.entries(confidenceLevelData).map(([key, data]) => [
    key,
    { ...data, icon: iconMap[data.iconName] }
  ])
);

/** Status config with icon components */
export const statusConfig = Object.fromEntries(
  Object.entries(statusConfigData).map(([key, data]) => [
    key,
    { ...data, icon: iconMap[data.iconName] }
  ])
);
