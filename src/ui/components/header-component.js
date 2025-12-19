/**
 * Header Component - Dashboard header with goal and time info
 */

import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';

const e = React.createElement;

/**
 * Header component showing goal and timing info
 * @param {object} props - Component props
 * @param {string} props.goal - Current goal description
 * @param {string} props.timeLimit - Time limit string
 * @param {number|null} props.startTime - Start timestamp
 */
export const Header = ({ goal, timeLimit, startTime }) => {
  return e(Box, { flexDirection: 'column', marginBottom: 0 },
    e(Gradient, { name: 'atlas' },
      e(BigText, { text: 'CLAUDE', font: 'tiny' })
    ),
    e(Text, { color: 'gray' }, 'Autonomous Runner'),
    e(Box, { borderStyle: 'round', borderColor: 'cyan', paddingX: 1, paddingY: 0, marginTop: 0 },
      e(Text, { color: 'white', bold: true }, goal)
    ),
    e(Box, { marginTop: 0 },
      e(Text, { color: 'gray' }, 'Time: '),
      e(Text, { color: 'white' }, timeLimit),
      e(Text, null, '  '),
      e(Text, { color: 'gray' }, 'Started: '),
      e(Text, { color: 'white' }, startTime ? new Date(startTime).toLocaleTimeString() : '--')
    )
  );
};

export default Header;
