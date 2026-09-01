'use client';

import { Check, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/providers/i18n-provider';

interface LanguageSwitcherProps {
  /**
   * `icon` is the compact form for the app header, where space is tight and
   * the globe reads on its own. `full` also spells out the current language,
   * for the login screen where nothing else hints that a choice exists.
   */
  variant?: 'icon' | 'full';
  className?: string;
}

export function LanguageSwitcher({ variant = 'icon', className }: LanguageSwitcherProps) {
  const { locale, setLocale, locales, localeLabels, t } = useTranslation();

  // A deployment that offers a single language has nothing to switch between,
  // and a control with one option only invites a pointless click.
  if (locales.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === 'icon' ? 'icon' : 'sm'}
          className={className}
          aria-label={t('language.change')}
          title={t('language.change')}
        >
          <Languages className="h-4 w-4" />
          {variant === 'full' && <span className="text-sm">{localeLabels[locale]}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('language.label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locales.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => setLocale(option)}
            // Each language names itself, so someone stranded in a language
            // they cannot read can still find their way back to their own.
            lang={option}
          >
            <Check
              className={`mr-2 h-4 w-4 ${option === locale ? 'opacity-100' : 'opacity-0'}`}
              aria-hidden="true"
            />
            {localeLabels[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
