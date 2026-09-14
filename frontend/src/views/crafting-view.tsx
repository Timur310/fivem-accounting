'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { craftingApi, itemTypesApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Hammer, Plus, Trash2, ArrowRight, Undo2, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDateTime } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import { cn } from '@/lib/utils';
import type {
  CraftingRecipe, CreditOutputTo, RecipeLine, RecipeLineInput,
} from '@/lib/api-types';

interface Props {
  factionId: string;
  /** Can write and retire recipes, and revert a craft. */
  canManageRecipes: boolean;
  /** Can run a saved recipe. */
  canCraft: boolean;
}

type Tab = 'bench' | 'recipes' | 'history';

/**
 * The crafting bench.
 *
 * Two audiences on one screen, which is why it is tabbed rather than split.
 * Most people who open this want to run a recipe and leave; the ones who write
 * the recipes do it rarely and do not need that work in their way the rest of
 * the time.
 *
 * The bench refuses before it asks. A card whose materials are short says
 * which one and by how much, and its button is disabled — being told no after
 * filling in a form is the thing this feature exists to stop.
 */
export function CraftingView({ factionId, canManageRecipes, canCraft }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('bench');
  const [editing, setEditing] = useState<CraftingRecipe | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CraftingRecipe | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  const recipesQuery = useQuery({
    queryKey: ['crafting-recipes', factionId],
    queryFn: () => craftingApi.recipes(factionId),
    staleTime: 0,
  });

  const historyQuery = useQuery({
    queryKey: ['crafting-history', factionId],
    queryFn: () => craftingApi.history(factionId),
    enabled: tab === 'history',
  });

  const itemTypesQuery = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    // Only the recipe editor needs them, and only leadership opens it.
    enabled: canManageRecipes,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['crafting-recipes', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['crafting-history', factionId] });
    // A craft moves the vault, so everything reading a balance is now stale.
    void queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
  };

  const deleteRecipe = useMutation({
    mutationFn: (id: string) => craftingApi.deleteRecipe(factionId, id),
    onSuccess: () => {
      setDeleting(null);
      refreshAll();
    },
    onError: (err) => toast({ title: apiErrorMessage(err), variant: 'destructive' }),
  });

  const revert = useMutation({
    mutationFn: (id: string) => craftingApi.revert(factionId, id),
    onSuccess: () => {
      setReverting(null);
      refreshAll();
    },
    onError: (err) =>
      toast({ title: t('crafting.revertFailed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const recipes = recipesQuery.data?.recipes ?? [];
  const runnable = recipes.filter((r) => r.isActive);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'bench', label: t('crafting.tab.bench') },
    ...(canManageRecipes ? [{ id: 'recipes' as const, label: t('crafting.tab.recipes') }] : []),
    { id: 'history', label: t('crafting.tab.history') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">{t('crafting.title')}</h1>
          <p className="text-meta text-zinc-500 mt-1 max-w-xl">{t('crafting.subtitle')}</p>
        </div>
        {canManageRecipes && (
          <Button onClick={() => setEditing('new')} className="shrink-0">
            <Plus className="h-4 w-4" />
            {t('crafting.newRecipe')}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-[var(--line-2)]">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors',
              tab === item.id
                ? 'border-[var(--brand-color,#6366f1)] text-brand'
                : 'border-transparent text-zinc-500 hover:text-zinc-200',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {recipesQuery.isError && <ErrorState error={recipesQuery.error} onRetry={() => void recipesQuery.refetch()} />}

      {tab === 'bench' && (
        recipesQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        ) : runnable.length === 0 ? (
          <EmptyState
            icon={Hammer}
            title={canManageRecipes ? t('crafting.recipes.none') : t('crafting.recipes.noneMember')}
            hint={canManageRecipes ? t('crafting.recipes.noneHint') : t('crafting.recipes.noneMemberHint')}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runnable.map((recipe) => (
              <BenchCard
                key={recipe.id}
                factionId={factionId}
                recipe={recipe}
                canCraft={canCraft}
                onCrafted={refreshAll}
              />
            ))}
          </div>
        )
      )}

      {tab === 'recipes' && canManageRecipes && (
        recipes.length === 0 ? (
          <EmptyState icon={Hammer} title={t('crafting.recipes.none')} hint={t('crafting.recipes.noneHint')} />
        ) : (
          <div className="space-y-3">
            {recipes.map((recipe) => (
              <Card key={recipe.id}>
                <CardContent className="p-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{recipe.name}</span>
                      {!recipe.isActive && (
                        <Badge variant="outline" className="text-micro">{t('crafting.retired')}</Badge>
                      )}
                      {recipe.creditOutputTo === 'crafter' && (
                        <Badge variant="outline" className="text-micro text-brand">
                          {t('crafting.creditCrafter')}
                        </Badge>
                      )}
                    </div>
                    <Formula recipe={recipe} />
                    {recipe.description && <p className="text-meta text-zinc-500">{recipe.description}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setEditing(recipe)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleting(recipe)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'history' && (
        historyQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (historyQuery.data?.crafts.length ?? 0) === 0 ? (
          <EmptyState icon={Hammer} title={t('crafting.history.none')} hint={t('crafting.history.noneHint')} />
        ) : (
          <div className="space-y-2">
            {historyQuery.data!.crafts.map((craft) => (
              <Card key={craft.id} className={cn(craft.revertedAt && 'opacity-60')}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {craft.quantity > 1 ? `${craft.quantity} × ` : ''}{craft.recipeName}
                      </span>
                      {craft.revertedAt && (
                        <Badge variant="outline" className="text-micro">{t('crafting.reverted')}</Badge>
                      )}
                    </div>
                    <p className="text-meta text-zinc-500">
                      {t('crafting.craftedBy', { name: craft.crafterName })} · {formatDateTime(craft.createdAt)}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap text-micro text-zinc-500">
                      <span>{craft.inputs.map((m) => movementLabel(m)).join(', ')}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{craft.outputs.map((m) => movementLabel(m)).join(', ')}</span>
                    </div>
                  </div>
                  {canManageRecipes && !craft.revertedAt && (
                    <Button variant="outline" size="sm" onClick={() => setReverting(craft.id)} className="shrink-0">
                      <Undo2 className="h-3.5 w-3.5" />
                      {t('crafting.revert')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {editing && (
        <RecipeEditor
          factionId={factionId}
          recipe={editing === 'new' ? null : editing}
          itemTypes={itemTypesQuery.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshAll();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('crafting.deleteRecipeConfirm', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('crafting.deleteRecipeBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteRecipe.mutate(deleting.id)}>
              {t('crafting.deleteRecipe')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reverting} onOpenChange={(open) => !open && setReverting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('crafting.revertConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('crafting.revertConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => reverting && revert.mutate(reverting)}>
              {t('crafting.revert')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** `10 Steel + 2 Powder → 1 Pistol`, the whole recipe in one line. */
function Formula({ recipe }: { recipe: CraftingRecipe }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-zinc-400">{recipe.inputs.map(lineLabel).join(' + ')}</span>
      <ArrowRight className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
      <span className="font-medium">{recipe.outputs.map(lineLabel).join(' + ')}</span>
    </div>
  );
}

function lineLabel(line: RecipeLine): string {
  const icon = line.icon ? `${line.icon} ` : '';
  return `${icon}${formatAmount(line.quantity, line.unit, line.isCurrency)} ${line.itemTypeName}`;
}

function movementLabel(m: { icon: string | null; quantity: string; unit: string; isCurrency: boolean; itemTypeName: string }): string {
  const icon = m.icon ? `${m.icon} ` : '';
  return `${icon}${formatAmount(m.quantity, m.unit, m.isCurrency)} ${m.itemTypeName}`;
}

/**
 * One recipe, ready to run.
 *
 * The count input is clamped to what the vault can actually afford, so the
 * common mistake — asking for more than there are materials for — is not
 * reachable rather than merely rejected.
 */
function BenchCard({
  factionId, recipe, canCraft, onCrafted,
}: {
  factionId: string;
  recipe: CraftingRecipe;
  canCraft: boolean;
  onCrafted: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [count, setCount] = useState('1');
  const [notes, setNotes] = useState('');

  const wanted = Math.max(1, Math.floor(Number(count) || 1));
  const affordable = recipe.maxCraftable > 0;
  const tooMany = wanted > recipe.maxCraftable;

  const craft = useMutation({
    mutationFn: () => craftingApi.craft(factionId, { recipeId: recipe.id, quantity: wanted, notes: notes || undefined }),
    onSuccess: () => {
      toast({ title: t('crafting.crafted', { count: wanted, name: recipe.name }) });
      setCount('1');
      setNotes('');
      onCrafted();
    },
    onError: (err) =>
      toast({ title: t('crafting.craftFailed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Card className={cn(!affordable && 'opacity-75')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{recipe.name}</span>
          <Badge
            variant="outline"
            className={cn('text-micro shrink-0', affordable ? 'text-brand' : 'text-zinc-400')}
          >
            {affordable ? t('crafting.canMake', { count: recipe.maxCraftable }) : t('crafting.canMakeNone')}
          </Badge>
        </div>

        {recipe.description && <p className="text-meta text-zinc-500">{recipe.description}</p>}

        <div className="space-y-1">
          {recipe.inputs.map((line) => {
            const needed = Number(line.quantity) * wanted;
            const have = Number(line.available ?? '0');
            const short = have < needed;
            return (
              <div key={line.itemTypeId} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-zinc-400 truncate">
                  {line.icon ? `${line.icon} ` : ''}{line.itemTypeName}
                </span>
                <span className={cn('text-micro tabular-nums shrink-0', short ? 'text-red-400' : 'text-zinc-500')}>
                  {formatAmount(String(needed), line.unit, line.isCurrency)}
                  {' / '}
                  {formatAmount(line.available ?? '0', line.unit, line.isCurrency)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[var(--line-1)] pt-3 space-y-1">
          {recipe.outputs.map((line) => (
            <div key={line.itemTypeId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">
                {line.icon ? `${line.icon} ` : ''}{line.itemTypeName}
              </span>
              <span className="text-micro tabular-nums text-emerald-400 shrink-0">
                +{formatAmount(String(Number(line.quantity) * wanted), line.unit, line.isCurrency)}
              </span>
            </div>
          ))}
        </div>

        {canCraft && (
          <div className="flex gap-2 pt-1">
            <Input
              type="number"
              min={1}
              max={Math.max(recipe.maxCraftable, 1)}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-20"
              aria-label={t('crafting.craftCount')}
              disabled={!affordable}
            />
            <Button
              className="flex-1"
              disabled={!affordable || tooMany || craft.isPending}
              onClick={() => craft.mutate()}
            >
              <Hammer className="h-4 w-4" />
              {t('crafting.craft')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Write or change a recipe. */
function RecipeEditor({
  factionId, recipe, itemTypes, onClose, onSaved,
}: {
  factionId: string;
  recipe: CraftingRecipe | null;
  itemTypes: { id: string; name: string; unit: string; isCurrency: boolean; isActive: boolean; icon?: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [name, setName] = useState(recipe?.name ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [creditOutputTo, setCreditOutputTo] = useState<CreditOutputTo>(recipe?.creditOutputTo ?? 'nobody');
  const [isActive, setIsActive] = useState(recipe?.isActive ?? true);
  const [inputs, setInputs] = useState<RecipeLineInput[]>(
    recipe?.inputs.map((l) => ({ itemTypeId: l.itemTypeId, quantity: l.quantity })) ?? [{ itemTypeId: '', quantity: '' }],
  );
  const [outputs, setOutputs] = useState<RecipeLineInput[]>(
    recipe?.outputs.map((l) => ({ itemTypeId: l.itemTypeId, quantity: l.quantity })) ?? [{ itemTypeId: '', quantity: '' }],
  );

  const options = useMemo<SearchableSelectOption[]>(
    () => itemTypes.filter((it) => it.isActive).map((it) => ({ value: it.id, label: it.name })),
    [itemTypes],
  );

  const clean = (lines: RecipeLineInput[]) =>
    lines.filter((l) => l.itemTypeId && Number(l.quantity) > 0);

  const cleanInputs = clean(inputs);
  const cleanOutputs = clean(outputs);
  const valid = name.trim().length > 0 && cleanInputs.length > 0 && cleanOutputs.length > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        creditOutputTo,
        isActive,
        inputs: cleanInputs,
        outputs: cleanOutputs,
      };
      return recipe
        ? craftingApi.updateRecipe(factionId, recipe.id, body)
        : craftingApi.createRecipe(factionId, body);
    },
    onSuccess: onSaved,
    onError: (err) => toast({ title: apiErrorMessage(err), variant: 'destructive' }),
  });

  const lineEditor = (
    label: string,
    lines: RecipeLineInput[],
    setLines: (next: RecipeLineInput[]) => void,
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              options={options}
              value={line.itemTypeId}
              onValueChange={(value: string) => setLines(lines.map((l, j) => (j === i ? { ...l, itemTypeId: value } : l)))}
            />
          </div>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            value={line.quantity}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
            className="w-24"
          />
          <Button
            variant="outline"
            size="sm"
            // The last line stays: a recipe with no rows at all gives the
            // editor nothing to show and no way back to a usable state.
            disabled={lines.length === 1}
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setLines([...lines, { itemTypeId: '', quantity: '' }])}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('crafting.addLine')}
      </Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe ? t('crafting.editRecipe') : t('crafting.newRecipe')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipe-name">{t('crafting.recipeName')}</Label>
            <Input
              id="recipe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('crafting.recipeNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipe-description">{t('crafting.recipeDescription')}</Label>
            <Textarea
              id="recipe-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('crafting.recipeDescriptionPlaceholder')}
              rows={2}
            />
          </div>

          {lineEditor(t('crafting.inputs'), inputs, setInputs)}
          {lineEditor(t('crafting.outputs'), outputs, setOutputs)}

          <div className="space-y-2">
            <Label>{t('crafting.credit')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['nobody', 'crafter'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCreditOutputTo(value)}
                  className={cn(
                    'text-left rounded-lg border p-3 transition-colors',
                    creditOutputTo === value
                      ? 'border-[var(--brand-color,#6366f1)] bg-[var(--fill-3)] text-zinc-100'
                      : 'border-[var(--line-2)] text-zinc-300 hover:border-[var(--line-3)] hover:bg-[var(--fill-1)]',
                  )}
                >
                  <div className="text-sm font-medium">
                    {value === 'nobody' ? t('crafting.creditNobody') : t('crafting.creditCrafter')}
                  </div>
                  <p className="text-micro text-zinc-400 mt-1">
                    {value === 'nobody' ? t('crafting.creditNobodyHint') : t('crafting.creditCrafterHint')}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="recipe-active">{t('common.active')}</Label>
              <p className="text-micro text-zinc-500">{t('crafting.retiredHint')}</p>
            </div>
            <Switch id="recipe-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
