interface LogoProps {
  size?: 'small' | 'large';
  color?: string;
}

const LOGO_SMALL = `╔═╗╔╦╗╔═╗╔═╗
║ ║ ║ ╚═╗║ ║
╚═╝ ╩ ╚═╝╚═╝`;

const LOGO_LARGE = `
 ██████╗ ████████╗███████╗ ██████╗
██╔═══██╗╚══██╔══╝██╔════╝██╔═══██╗
██║   ██║   ██║   ███████╗██║   ██║
██║   ██║   ██║   ╚════██║██║   ██║
╚██████╔╝   ██║   ███████║╚██████╔╝
 ╚═════╝    ╚═╝   ╚══════╝ ╚═════╝
`;

/**
 * ASCII art Otso logo.
 * Available in small (3 lines) and large (6 lines) variants.
 */
export function Logo({ size = 'small', color = '#00D4AA' }: LogoProps) {
  const logo = size === 'large' ? LOGO_LARGE : LOGO_SMALL;

  return (
    <text fg={color}>
      <strong>{logo}</strong>
    </text>
  );
}
