import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, FolderPlus, Image as ImageIcon, Pause, Play, Plus, Save, Search, Send, Square, Trash2, X } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '../components/ui';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import { formatCurrency } from '../services/numberFormat';
import { loadData, updateTelegramProfileState } from '../services/storage';
import {
  createTelegramProductPost,
  getLiveTelegramCollections,
  getTelegramCollectionActivity,
  pauseTelegramCollection,
  resumeTelegramCollection,
  startTelegramCollection,
  stopTelegramCollection,
} from '../services/telegram';
import {
  Product,
  StoreProfile,
  TelegramCollectionActivityItem,
  TelegramCollectionFrequencyUnit,
  TelegramCollectionRepeatMode,
  TelegramLiveCollection,
  TelegramPostActivity,
  TelegramPostCollection,
  TelegramPostMode,
  TelegramSchedulerProduct,
} from '../types';

const DEFAULT_TEMPLATE = `New arrival: {product_name}

Price: {price}
Category: {category}
Stock: {stock}

Order now while stock lasts!`;

const MAX_ACTIVITY_ENTRIES = 25;
const DEFAULT_FREQUENCY_VALUE = 1;
const DEFAULT_FREQUENCY_UNIT: TelegramCollectionFrequencyUnit = 'minutes';
const DEFAULT_REPEAT_MODE: TelegramCollectionRepeatMode = 'loop';
const TELEGRAM_DEBUG_LOGS_ENABLED = String((import.meta as any).env?.VITE_DEBUG_TELEGRAM_LOGS || 'false').toLowerCase() === 'true';
const DEFAULT_MAX_FAILURES_BEFORE_PAUSE = 3;
const DEFAULT_BATCH_SIZE = 2;
const MIN_TELEGRAM_SECONDS_INTERVAL = 3;
const TELEGRAM_CHANNEL_REQUIRED_MESSAGE = 'Telegram Channel ID is required. Save a channel ID for this collection first.';

const safeText = (value: unknown, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const toNonNegativeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return date.toLocaleString();
};

const getProductImageUrl = (product?: Product | null) => {
  if (!product) return '';
  const imageObj = Array.isArray((product as any).images) ? (product as any).images[0] : null;
  return String(
    (product as any).thumbnailImage
    || product.image
    || (product as any).imageSrc
    || (Array.isArray((product as any).galleryImages) ? (product as any).galleryImages[0] : '')
    || imageObj?.src
    || imageObj?.url
    || ''
  ).trim();
};

const getProductName = (product?: Product | null) => safeText(product?.name, 'Unnamed product');
const getProductCategory = (product?: Product | null) => safeText(product?.category, 'General');
const getProductBarcode = (product?: Product | null) => safeText(product?.barcode, '-');

const normalizeCollections = (profile?: StoreProfile | null): TelegramPostCollection[] => (
  Array.isArray(profile?.telegramCollections)
    ? profile!.telegramCollections!.map((collection) => ({
        ...collection,
        category: safeText(collection.category, 'all'),
        channelId: safeText(collection.channelId),
        template: safeText(collection.template, DEFAULT_TEMPLATE),
        notes: safeText(collection.notes),
        postMode: collection.postMode === 'out_of_stock' || collection.postMode === 'filtered' ? collection.postMode : 'selected',
        queuedProductIds: Array.isArray(collection.queuedProductIds) ? collection.queuedProductIds.filter(Boolean) : [],
        frequencyValue: toNonNegativeNumber(collection.frequencyValue, DEFAULT_FREQUENCY_VALUE) || DEFAULT_FREQUENCY_VALUE,
        frequencyUnit: (safeText(collection.frequencyUnit, DEFAULT_FREQUENCY_UNIT) as TelegramCollectionFrequencyUnit),
        batchSize: toNonNegativeNumber((collection as any).batchSize, DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
        autoStartTime: safeText((collection as any).autoStartTime),
        repeatMode: (safeText(collection.repeatMode, DEFAULT_REPEAT_MODE) as TelegramCollectionRepeatMode),
        maxFailuresBeforePause: toNonNegativeNumber(collection.maxFailuresBeforePause, DEFAULT_MAX_FAILURES_BEFORE_PAUSE) || DEFAULT_MAX_FAILURES_BEFORE_PAUSE,
        createdAt: safeText(collection.createdAt, new Date().toISOString()),
        updatedAt: safeText(collection.updatedAt, new Date().toISOString()),
        totalPostsSent: toNonNegativeNumber(collection.totalPostsSent),
      }))
    : []
);

const normalizeActivity = (profile?: StoreProfile | null): TelegramPostActivity[] => (
  Array.isArray(profile?.telegramPostActivity)
    ? profile!.telegramPostActivity!.map((entry) => ({
        ...entry,
        category: safeText(entry.category, 'all'),
        channelId: safeText(entry.channelId),
        postMode: entry.postMode === 'out_of_stock' || entry.postMode === 'filtered' ? entry.postMode : 'selected',
        productCount: toNonNegativeNumber(entry.productCount),
        successCount: toNonNegativeNumber(entry.successCount),
        failureCount: toNonNegativeNumber(entry.failureCount),
        postedAt: safeText(entry.postedAt, new Date().toISOString()),
      }))
    : []
);

export default function TelegramPosts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [postMode, setPostMode] = useState<TelegramPostMode>('selected');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortOption, setSortOption] = useState<'name-asc' | 'stock-desc' | 'stock-asc' | 'price-desc' | 'price-asc'>('name-asc');
  const [queueSearchTerm, setQueueSearchTerm] = useState('');
  const [queuedProductIds, setQueuedProductIds] = useState<string[]>([]);
  const [telegramChannelId, setTelegramChannelId] = useState('');
  const [telegramChannels, setTelegramChannels] = useState<string[]>([]);
  const [telegramTemplate, setTelegramTemplate] = useState(DEFAULT_TEMPLATE);
  const [telegramNotes, setTelegramNotes] = useState('');
  const [telegramCollections, setTelegramCollections] = useState<TelegramPostCollection[]>([]);
  const [telegramActivity, setTelegramActivity] = useState<TelegramPostActivity[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [collectionChannelId, setCollectionChannelId] = useState('');
  const [collectionCategory, setCollectionCategory] = useState('all');
  const [frequencyValue, setFrequencyValue] = useState(String(DEFAULT_FREQUENCY_VALUE));
  const [frequencyUnit, setFrequencyUnit] = useState<TelegramCollectionFrequencyUnit>(DEFAULT_FREQUENCY_UNIT);
  const [batchSize, setBatchSize] = useState(String(DEFAULT_BATCH_SIZE));
  const [autoStartTime, setAutoStartTime] = useState('');
  const [repeatMode, setRepeatMode] = useState<TelegramCollectionRepeatMode>(DEFAULT_REPEAT_MODE);
  const [maxFailuresBeforePause, setMaxFailuresBeforePause] = useState(String(DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isStartingCollection, setIsStartingCollection] = useState(false);
  const [runningCollections, setRunningCollections] = useState<TelegramLiveCollection[]>([]);
  const [selectedActivityCollectionId, setSelectedActivityCollectionId] = useState('');
  const [selectedCollectionActivity, setSelectedCollectionActivity] = useState<TelegramCollectionActivityItem[]>([]);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [collectionActionId, setCollectionActionId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const refreshFromStore = () => {
    const data = loadData();
    const safeProfile = data.profile;
    const collections = normalizeCollections(safeProfile);
    const activity = normalizeActivity(safeProfile);
    setProducts(Array.isArray(data.products) ? data.products : []);
    setProfile(safeProfile);
    setTelegramCollections(collections);
    setTelegramActivity(activity);
    setTelegramChannelId(safeText(safeProfile?.telegramChannelId));
    const normalizedChannels = Array.from(new Set(
      [
        ...(Array.isArray(safeProfile?.telegramChannels) ? safeProfile!.telegramChannels! : []),
        ...collections.map((collection) => safeText(collection.channelId)),
        safeText(safeProfile?.telegramChannelId),
      ].map((channelId) => safeText(channelId)).filter(Boolean)
    ));
    setTelegramChannels(normalizedChannels);
    setSelectedChannelId((current) => {
      if (current && normalizedChannels.includes(current)) return current;
      return normalizedChannels[0] || '';
    });
    setTelegramTemplate(safeText(safeProfile?.telegramTemplate, DEFAULT_TEMPLATE));
    setTelegramNotes(safeText(safeProfile?.telegramNotes));
    const storedActiveCollectionId = safeText(safeProfile?.telegramActiveCollectionId);
    const selectedCollection = collections.find((collection) => collection.id === storedActiveCollectionId) || null;
    setActiveCollectionId(selectedCollection?.id || '');
    setCollectionName(selectedCollection?.name || '');
    setCollectionChannelId(selectedCollection?.channelId || safeText(safeProfile?.telegramChannelId));
    setCollectionCategory(selectedCollection?.category || 'all');
    setFrequencyValue(String(selectedCollection?.frequencyValue || DEFAULT_FREQUENCY_VALUE));
    setFrequencyUnit((selectedCollection?.frequencyUnit || DEFAULT_FREQUENCY_UNIT) as TelegramCollectionFrequencyUnit);
    setBatchSize(String((selectedCollection as any)?.batchSize || DEFAULT_BATCH_SIZE));
    setAutoStartTime((selectedCollection as any)?.autoStartTime || '');
    setRepeatMode((selectedCollection?.repeatMode || DEFAULT_REPEAT_MODE) as TelegramCollectionRepeatMode);
    setMaxFailuresBeforePause(String(selectedCollection?.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
    if (selectedCollection) {
      setTelegramChannelId(selectedCollection.channelId || safeText(safeProfile?.telegramChannelId));
      setCollectionChannelId(selectedCollection.channelId || safeText(safeProfile?.telegramChannelId));
      setTelegramTemplate(selectedCollection.template || safeText(safeProfile?.telegramTemplate, DEFAULT_TEMPLATE));
      setTelegramNotes(selectedCollection.notes || safeText(safeProfile?.telegramNotes));
      setPostMode(selectedCollection.postMode);
      setQueuedProductIds(selectedCollection.queuedProductIds || []);
      setCategoryFilter(selectedCollection.category || 'all');
    } else {
      setFrequencyValue(String(DEFAULT_FREQUENCY_VALUE));
      setFrequencyUnit(DEFAULT_FREQUENCY_UNIT);
      setBatchSize(String(DEFAULT_BATCH_SIZE));
      setAutoStartTime('');
      setRepeatMode(DEFAULT_REPEAT_MODE);
      setMaxFailuresBeforePause(String(DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
    }
  };

  useEffect(() => {
    refreshFromStore();
    window.addEventListener('storage', refreshFromStore);
    window.addEventListener('local-storage-update', refreshFromStore);
    return () => {
      window.removeEventListener('storage', refreshFromStore);
      window.removeEventListener('local-storage-update', refreshFromStore);
    };
  }, []);

  const refreshRunningCollections = async (options?: { silent?: boolean }) => {
    try {
      const live = await getLiveTelegramCollections();
      setRunningCollections(live);
    } catch (error) {
      if (!options?.silent) {
        setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Backend not reachable' });
      }
    }
  };

  useEffect(() => {
    void refreshRunningCollections({ silent: true });
    const interval = window.setInterval(() => {
      void refreshRunningCollections({ silent: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const filterCategories = useMemo(() => (
    ['all', ...Array.from(new Set(products.map((product) => getProductCategory(product)).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))]
  ), [products]);

  const filteredProducts = useMemo(() => {
    const next = products.filter((product) => {
      const haystack = [
        product.name,
        product.barcode,
        product.category,
        (product as any).locationZone,
        (product as any).locationRow,
        (product as any).locationRack,
        (product as any).locationShelf,
      ].map((value) => safeText(value).toLowerCase()).join(' ');
      const matchesSearch = haystack.includes(searchTerm.trim().toLowerCase());
      const matchesCategory = categoryFilter === 'all' || getProductCategory(product) === categoryFilter;
      return matchesSearch && matchesCategory;
    });

    next.sort((left, right) => {
      if (sortOption === 'stock-desc') return toNonNegativeNumber(right.stock) - toNonNegativeNumber(left.stock);
      if (sortOption === 'stock-asc') return toNonNegativeNumber(left.stock) - toNonNegativeNumber(right.stock);
      if (sortOption === 'price-desc') return toNonNegativeNumber(right.sellPrice || right.buyPrice) - toNonNegativeNumber(left.sellPrice || left.buyPrice);
      if (sortOption === 'price-asc') return toNonNegativeNumber(left.sellPrice || left.buyPrice) - toNonNegativeNumber(right.sellPrice || right.buyPrice);
      return getProductName(left).localeCompare(getProductName(right));
    });

    return next;
  }, [products, searchTerm, categoryFilter, sortOption]);

  const queuedProducts = useMemo(() => {
    const queueSet = new Set(queuedProductIds);
    return queuedProductIds
      .map((id) => products.find((product) => product.id === id))
      .filter((product): product is Product => Boolean(product && queueSet.has(product.id)));
  }, [products, queuedProductIds]);

  const queueFilteredProducts = useMemo(() => {
    const needle = queueSearchTerm.trim().toLowerCase();
    if (!needle) return queuedProducts;
    return queuedProducts.filter((product) => {
      const haystack = `${getProductName(product)} ${getProductBarcode(product)} ${getProductCategory(product)}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [queueSearchTerm, queuedProducts]);

  const targetProducts = useMemo(() => {
    return queuedProducts;
  }, [queuedProducts]);
  const collectionProducts = queuedProducts;

  const previewProduct = targetProducts[0] || queuedProducts[0] || filteredProducts[0] || null;
  const activeCollection = telegramCollections.find((collection) => collection.id === activeCollectionId) || null;
  const recentActivity = [...telegramActivity].sort((left, right) => new Date(right.postedAt).getTime() - new Date(left.postedAt).getTime());
  const lastPostedEntry = recentActivity[0] || null;
  const totalPostedCount = recentActivity.reduce((sum, entry) => sum + toNonNegativeNumber(entry.successCount), 0);
  const categoryCollections = telegramCollections.filter((collection) => collection.category === categoryFilter || (categoryFilter === 'all' && collection.category === 'all'));
  const failedProducts = selectedCollectionActivity.filter((entry) => entry.error);
  const ownedRunningCollectionIds = useMemo(() => {
    return new Set(
      telegramCollections
        .map((collection) => safeText(collection.id))
        .filter(Boolean)
    );
  }, [telegramCollections]);
  const visibleRunningCollections = runningCollections.filter((collection) => {
    const status = safeText(collection.status).toLowerCase();
    if (status === 'stopped' || status === 'completed') return false;
    const backendCollectionId = safeText(collection.collectionId || collection.id);
    return Boolean(backendCollectionId) && ownedRunningCollectionIds.has(backendCollectionId);
  });
  const hiddenForeignRunningCollectionsCount = Math.max(0, runningCollections.length - visibleRunningCollections.length);
  const livePostedCount = visibleRunningCollections.reduce((sum, entry) => sum + toNonNegativeNumber(entry.sentCount), 0);
  const savedChannels = useMemo(() => (
    Array.from(new Set(
      [...telegramChannels, ...telegramCollections.map((collection) => safeText(collection.channelId)), safeText(telegramChannelId)]
        .map((channelId) => safeText(channelId))
        .filter(Boolean)
    ))
  ), [telegramChannels, telegramCollections, telegramChannelId]);
  const selectedChannelCollections = useMemo(() => (
    telegramCollections
      .filter((collection) => safeText(collection.channelId) === safeText(selectedChannelId))
      .sort((left, right) => left.name.localeCompare(right.name))
  ), [selectedChannelId, telegramCollections]);
  const activeChannelSavedCollections = useMemo(() => (
    telegramCollections
      .filter((collection) => safeText(collection.channelId) === safeText(selectedChannelId))
      .sort((left, right) => left.name.localeCompare(right.name))
  ), [selectedChannelId, telegramCollections]);
  const activeChannelRunningCollections = useMemo(() => (
    visibleRunningCollections
      .filter((collection) => safeText(collection.channelId) === safeText(selectedChannelId))
      .sort((left, right) => left.name.localeCompare(right.name))
  ), [selectedChannelId, visibleRunningCollections]);
  const runningCollectionsBySavedId = useMemo(() => {
    const next = new Map<string, TelegramLiveCollection>();
    visibleRunningCollections.forEach((collection) => {
      const backendCollectionId = safeText(collection.collectionId || collection.id);
      if (backendCollectionId) {
        next.set(backendCollectionId, collection);
      }
    });
    return next;
  }, [visibleRunningCollections]);
  const runningCollectionsByChannel = useMemo(() => {
    const groups = new Map<string, TelegramLiveCollection[]>();
    visibleRunningCollections.forEach((collection) => {
      const channelId = safeText(collection.channelId, 'Unassigned channel');
      const current = groups.get(channelId) || [];
      current.push(collection);
      groups.set(channelId, current);
    });
    return Array.from(groups.entries())
      .map(([channelId, collections]) => ({
        channelId,
        collections: collections.sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.channelId.localeCompare(right.channelId));
  }, [visibleRunningCollections]);
  useEffect(() => {
    if (!savedChannels.length) {
      if (selectedChannelId) setSelectedChannelId('');
      return;
    }
    if (!savedChannels.includes(selectedChannelId)) {
      setSelectedChannelId(savedChannels[0]);
    }
  }, [savedChannels, selectedChannelId]);

  const buildCaption = (product: Product | null) => {
    if (!product) return '';
    const replacements: Record<string, string> = {
      '{product_name}': getProductName(product),
      '{price}': formatCurrency(toNonNegativeNumber(product.sellPrice || product.buyPrice)),
      '{category}': getProductCategory(product),
      '{stock}': String(toNonNegativeNumber(product.stock)),
      '{barcode}': getProductBarcode(product),
    };
    let output = telegramTemplate || DEFAULT_TEMPLATE;
    Object.entries(replacements).forEach(([token, value]) => {
      output = output.split(token).join(value);
    });
    return output;
  };

  const buildSchedulerProducts = (rows: Product[]): TelegramSchedulerProduct[] => rows.map((product) => ({
    id: product.id,
    name: getProductName(product),
    description: safeText(product.description),
    price: toNonNegativeNumber(product.buyPrice),
    salePrice: toNonNegativeNumber(product.sellPrice || product.buyPrice),
    imageUrl: getProductImageUrl(product),
    category: getProductCategory(product),
    stock: toNonNegativeNumber(product.stock),
    barcode: getProductBarcode(product),
  }));

  const resolveFrequencyValue = () => {
    const parsed = Number(frequencyValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FREQUENCY_VALUE;
    return Math.max(frequencyUnit === 'seconds' ? MIN_TELEGRAM_SECONDS_INTERVAL : 1, Math.floor(parsed));
  };

  const resolveMaxFailuresBeforePause = () => {
    const parsed = Number(maxFailuresBeforePause);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_FAILURES_BEFORE_PAUSE;
    return Math.max(1, Math.floor(parsed));
  };
  const resolveBatchSize = () => {
    const parsed = Number(batchSize);
    return [2, 4, 6, 8].includes(parsed) ? parsed : DEFAULT_BATCH_SIZE;
  };

  const getResolvedTelegramChannelId = () => safeText(telegramChannelId).trim();

  const requireTelegramChannelId = () => {
    const channelId = getResolvedTelegramChannelId();
    if (!channelId) {
      throw new Error(TELEGRAM_CHANNEL_REQUIRED_MESSAGE);
    }
    return channelId;
  };

  const persistTelegramProfile = async (nextValues: {
    telegramChannelId?: string;
    telegramChannels?: string[];
    telegramTemplate?: string;
    telegramNotes?: string;
    telegramCollections?: TelegramPostCollection[];
    telegramPostActivity?: TelegramPostActivity[];
    telegramActiveCollectionId?: string;
  }, options?: { successMessage?: string; suppressNotice?: boolean }) => {
    if (!profile) return null;
    const nextProfile: StoreProfile = {
      ...profile,
      telegramChannelId: nextValues.telegramChannelId ?? telegramChannelId.trim(),
      telegramChannels: nextValues.telegramChannels ?? telegramChannels,
      telegramTemplate: nextValues.telegramTemplate ?? (telegramTemplate.trim() || DEFAULT_TEMPLATE),
      telegramNotes: nextValues.telegramNotes ?? telegramNotes.trim(),
      telegramCollections: nextValues.telegramCollections ?? telegramCollections,
      telegramPostActivity: nextValues.telegramPostActivity ?? telegramActivity,
      telegramActiveCollectionId: nextValues.telegramActiveCollectionId ?? activeCollectionId,
    };
    const saved = await updateTelegramProfileState({
      telegramChannelId: nextProfile.telegramChannelId,
      telegramChannels: nextProfile.telegramChannels,
      telegramTemplate: nextProfile.telegramTemplate,
      telegramNotes: nextProfile.telegramNotes,
      telegramCollections: nextProfile.telegramCollections,
      telegramPostActivity: nextProfile.telegramPostActivity,
      telegramActiveCollectionId: nextProfile.telegramActiveCollectionId,
    });
    setProfile(saved);
    setTelegramChannels(Array.isArray(saved.telegramChannels) ? saved.telegramChannels.map((channelId) => safeText(channelId)).filter(Boolean) : []);
    setTelegramCollections(normalizeCollections(saved));
    setTelegramActivity(normalizeActivity(saved));
    return saved;
  };

  const addTelegramChannel = async () => {
    const channelId = safeText(newChannelId);
    if (!channelId) {
      setNotice({ type: 'error', message: 'Channel ID is required.' });
      return;
    }
    const nextChannels = Array.from(new Set([...savedChannels, channelId]));
    try {
      const saved = await persistTelegramProfile({
        telegramChannels: nextChannels,
        telegramChannelId: safeText(telegramChannelId) || channelId,
      }, { suppressNotice: true });
      if (saved) {
        setTelegramChannelId((current) => current || channelId);
        setSelectedChannelId(channelId);
        setNewChannelId('');
        setNotice({ type: 'success', message: 'Channel added.' });
      }
    } catch (error) {
      setNotice({ type: 'error', message: getFriendlyErrorMessage(error, 'telegram.channel_add') });
    }
  };

  const addProductToQueue = (productId: string) => {
    setQueuedProductIds((current) => current.includes(productId) ? current : [...current, productId]);
  };

  const removeProductFromQueue = (productId: string) => {
    setQueuedProductIds((current) => current.filter((id) => id !== productId));
  };

  const clearQueue = () => {
    setQueuedProductIds([]);
  };

  const loadCollection = (collectionId: string) => {
    const collection = telegramCollections.find((item) => item.id === collectionId);
    setActiveCollectionId(collection?.id || '');
    setCollectionName(collection?.name || '');
    setCollectionChannelId(collection?.channelId || safeText(profile?.telegramChannelId));
    setCollectionCategory(collection?.category || 'all');
    if (!collection) {
      setFrequencyValue(String(DEFAULT_FREQUENCY_VALUE));
      setFrequencyUnit(DEFAULT_FREQUENCY_UNIT);
      setBatchSize(String(DEFAULT_BATCH_SIZE));
      setAutoStartTime('');
      setRepeatMode(DEFAULT_REPEAT_MODE);
      setMaxFailuresBeforePause(String(DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
      return;
    }
    setTelegramChannelId(collection.channelId);
    setTelegramTemplate(collection.template || DEFAULT_TEMPLATE);
    setTelegramNotes(collection.notes);
    setPostMode('selected');
    setQueuedProductIds(collection.queuedProductIds || []);
    setCategoryFilter(collection.category || 'all');
    setFrequencyValue(String(collection.frequencyValue || DEFAULT_FREQUENCY_VALUE));
    setFrequencyUnit((collection.frequencyUnit || DEFAULT_FREQUENCY_UNIT) as TelegramCollectionFrequencyUnit);
    setBatchSize(String((collection as any).batchSize || DEFAULT_BATCH_SIZE));
    setAutoStartTime((collection as any).autoStartTime || '');
    setRepeatMode((collection.repeatMode || DEFAULT_REPEAT_MODE) as TelegramCollectionRepeatMode);
    setMaxFailuresBeforePause(String(collection.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
    void persistTelegramProfile({ telegramActiveCollectionId: collection.id }, { suppressNotice: true });
  };

  const saveTelegramSettings = async () => {
    setIsSavingSettings(true);
    setNotice(null);
    try {
      const channelId = requireTelegramChannelId();
      const saved = await persistTelegramProfile({
        telegramChannelId: channelId,
        telegramChannels: Array.from(new Set([...savedChannels, channelId])),
        telegramTemplate: telegramTemplate.trim() || DEFAULT_TEMPLATE,
        telegramNotes: telegramNotes.trim(),
      });
      if (saved) {
        setTelegramChannelId(safeText(saved.telegramChannelId));
        setTelegramTemplate(safeText(saved.telegramTemplate, DEFAULT_TEMPLATE));
        setTelegramNotes(safeText(saved.telegramNotes));
        setNotice({ type: 'success', message: 'Telegram default settings saved.' });
      }
    } catch (error) {
      setNotice({ type: 'error', message: getFriendlyErrorMessage(error, 'telegram.settings') });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const saveCollection = async () => {
    const trimmedName = collectionName.trim();
    if (!trimmedName) {
      setNotice({ type: 'error', message: 'Collection name is required.' });
      return;
    }
    setIsSavingCollection(true);
    setNotice(null);
    try {
      const channelId = safeText(collectionChannelId).trim() || requireTelegramChannelId();
      const now = new Date().toISOString();
      const nextCollection: TelegramPostCollection = {
        id: activeCollection?.id || `telegram-collection-${Date.now()}`,
        name: trimmedName,
        category: collectionCategory || categoryFilter || 'all',
        channelId,
        template: telegramTemplate.trim() || DEFAULT_TEMPLATE,
        notes: telegramNotes.trim(),
        postMode,
        queuedProductIds,
        frequencyValue: resolveFrequencyValue(),
        frequencyUnit,
        batchSize: resolveBatchSize(),
        autoStartTime: autoStartTime.trim(),
        repeatMode,
        maxFailuresBeforePause: resolveMaxFailuresBeforePause(),
        createdAt: activeCollection?.createdAt || now,
        updatedAt: now,
        lastPostedAt: activeCollection?.lastPostedAt,
        lastPostedProductName: activeCollection?.lastPostedProductName,
        totalPostsSent: toNonNegativeNumber(activeCollection?.totalPostsSent),
      };
      const nextCollections = activeCollection
        ? telegramCollections.map((collection) => collection.id === activeCollection.id ? nextCollection : collection)
        : [nextCollection, ...telegramCollections].sort((left, right) => left.name.localeCompare(right.name));
      const saved = await persistTelegramProfile({
        telegramChannelId: channelId,
        telegramChannels: Array.from(new Set([...savedChannels, channelId])),
        telegramCollections: nextCollections,
        telegramActiveCollectionId: nextCollection.id,
      });
      if (saved) {
        setActiveCollectionId(nextCollection.id);
        setCollectionName(nextCollection.name);
        setCollectionChannelId(nextCollection.channelId);
        setCollectionCategory(nextCollection.category);
        setNotice({ type: 'success', message: activeCollection ? 'Collection updated.' : 'Collection created.' });
      }
    } catch (error) {
      setNotice({ type: 'error', message: getFriendlyErrorMessage(error, 'telegram.collection_save') });
    } finally {
      setIsSavingCollection(false);
    }
  };

  const deleteCollectionById = async (collectionId: string) => {
    const targetCollection = telegramCollections.find((collection) => collection.id === collectionId);
    if (!targetCollection) return;
    setIsSavingCollection(true);
    setNotice(null);
    try {
      const nextCollections = telegramCollections.filter((collection) => collection.id !== targetCollection.id);
      await persistTelegramProfile({
        telegramCollections: nextCollections,
        telegramActiveCollectionId: '',
      });
      if (activeCollection?.id === targetCollection.id) {
        setActiveCollectionId('');
        setCollectionName('');
        setCollectionChannelId(safeText(selectedChannelId || profile?.telegramChannelId));
        setCollectionCategory(categoryFilter);
      }
      setNotice({ type: 'success', message: 'Collection removed.' });
    } catch (error) {
      setNotice({ type: 'error', message: getFriendlyErrorMessage(error, 'telegram.collection_delete') });
    } finally {
      setIsSavingCollection(false);
    }
  };
  const deleteCollection = async () => {
    if (!activeCollection) return;
    await deleteCollectionById(activeCollection.id);
  };

  const createFreshCollectionDraft = (preferredChannelId?: string) => {
    setActiveCollectionId('');
    setCollectionName('');
    const nextChannelId = safeText(preferredChannelId || selectedChannelId || telegramChannelId).trim();
    setCollectionChannelId(nextChannelId);
    setTelegramChannelId(nextChannelId);
    setCollectionCategory(categoryFilter);
    setFrequencyValue(String(DEFAULT_FREQUENCY_VALUE));
    setFrequencyUnit(DEFAULT_FREQUENCY_UNIT);
    setBatchSize(String(DEFAULT_BATCH_SIZE));
    setAutoStartTime('');
    setRepeatMode(DEFAULT_REPEAT_MODE);
    setMaxFailuresBeforePause(String(DEFAULT_MAX_FAILURES_BEFORE_PAUSE));
  };

  const openCollectionModal = (channelId?: string, collectionId?: string) => {
    const resolvedChannelId = safeText(channelId || selectedChannelId || telegramChannelId);
    if (collectionId) {
      loadCollection(collectionId);
    } else {
      createFreshCollectionDraft(resolvedChannelId);
    }
    if (resolvedChannelId) {
      setSelectedChannelId(resolvedChannelId);
      setCollectionChannelId(resolvedChannelId);
      setTelegramChannelId(resolvedChannelId);
    }
    setIsCollectionModalOpen(true);
  };

  const ensureCollectionSaved = async () => {
    const trimmedName = collectionName.trim();
    if (!trimmedName) {
      throw new Error('Collection name is required.');
    }
    const channelId = safeText(collectionChannelId).trim() || requireTelegramChannelId();
    const now = new Date().toISOString();
    const nextCollection: TelegramPostCollection = {
      id: activeCollection?.id || `telegram-collection-${Date.now()}`,
      name: trimmedName,
      category: collectionCategory || categoryFilter || 'all',
      channelId,
      template: telegramTemplate.trim() || DEFAULT_TEMPLATE,
      notes: telegramNotes.trim(),
      postMode: 'selected',
      queuedProductIds,
      frequencyValue: resolveFrequencyValue(),
      frequencyUnit,
      batchSize: resolveBatchSize(),
      autoStartTime: autoStartTime.trim(),
      repeatMode,
      maxFailuresBeforePause: resolveMaxFailuresBeforePause(),
      createdAt: activeCollection?.createdAt || now,
      updatedAt: now,
      lastPostedAt: activeCollection?.lastPostedAt,
      lastPostedProductName: activeCollection?.lastPostedProductName,
      totalPostsSent: toNonNegativeNumber(activeCollection?.totalPostsSent),
    };
    const nextCollections = activeCollection
      ? telegramCollections.map((collection) => collection.id === activeCollection.id ? nextCollection : collection)
      : [nextCollection, ...telegramCollections].sort((left, right) => left.name.localeCompare(right.name));
    const saved = await persistTelegramProfile({
      telegramChannelId: channelId,
      telegramChannels: Array.from(new Set([...savedChannels, channelId])),
      telegramCollections: nextCollections,
      telegramActiveCollectionId: nextCollection.id,
    });
    if (!saved) {
      throw new Error('Collection could not be saved.');
    }
    setActiveCollectionId(nextCollection.id);
    setCollectionName(nextCollection.name);
    setCollectionChannelId(nextCollection.channelId);
    setCollectionCategory(nextCollection.category);
    return nextCollection;
  };

  const loadActivityForCollection = async (id: string) => {
    setSelectedActivityCollectionId(id);
    setIsActivityLoading(true);
    try {
      const activity = await getTelegramCollectionActivity(id);
      setSelectedCollectionActivity(activity);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Backend not reachable' });
      setSelectedCollectionActivity([]);
    } finally {
      setIsActivityLoading(false);
    }
  };

  const handleCollectionAction = async (
    action: 'pause' | 'resume' | 'stop',
    collection: TelegramLiveCollection,
    handler: () => Promise<unknown>,
    successMessage: string,
  ) => {
    const collectionId = safeText(collection.collectionId || collection.id);
    if (TELEGRAM_DEBUG_LOGS_ENABLED) {
      console.log('telegram.collection.control', {
        action,
        collectionId,
        collectionName: collection.name,
        status: collection.status,
        hasCollectionId: Boolean(collectionId),
      });
    }
    if (!collectionId) {
      setNotice({ type: 'error', message: 'Collection ID missing. Refresh live collections and try again.' });
      return;
    }
    setCollectionActionId(collectionId);
    try {
      await handler();
      setNotice({ type: 'success', message: successMessage });
      await refreshRunningCollections({ silent: true });
      if (selectedActivityCollectionId === collectionId) {
        await loadActivityForCollection(collectionId);
      }
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Backend not reachable' });
    } finally {
      setCollectionActionId('');
    }
  };

  const getSavedCollectionProducts = (collection: TelegramPostCollection) => {
    const queueSet = new Set(collection.queuedProductIds || []);
    return (collection.queuedProductIds || [])
      .map((id) => products.find((product) => product.id === id))
      .filter((product): product is Product => Boolean(product && queueSet.has(product.id)));
  };

  const startSavedCollectionRun = async (collection: TelegramPostCollection) => {
    const collectionProductsToSend = getSavedCollectionProducts(collection);
    if (!collectionProductsToSend.length) {
      setNotice({ type: 'error', message: 'Add at least one product before starting a collection.' });
      return;
    }
    const missingImageProduct = collectionProductsToSend.find((product) => !getProductImageUrl(product));
    if (missingImageProduct) {
      setNotice({ type: 'error', message: 'Product missing image.' });
      return;
    }

    setIsStartingCollection(true);
    setActiveCollectionId(collection.id);
    setNotice({ type: 'info', message: `Starting ${collection.name}...` });
    try {
      requireTelegramChannelId();
      const schedulerProducts = buildSchedulerProducts(collectionProductsToSend);
      await startTelegramCollection({
        id: collection.id,
        collectionId: collection.id,
        name: collection.name,
        channelId: collection.channelId,
        template: collection.template,
        notes: collection.notes,
        category: collection.category,
        frequencyValue: collection.frequencyValue || DEFAULT_FREQUENCY_VALUE,
        frequencyUnit: (collection.frequencyUnit || DEFAULT_FREQUENCY_UNIT) as TelegramCollectionFrequencyUnit,
        batchSize: (collection as any).batchSize || DEFAULT_BATCH_SIZE,
        autoStartTime: (collection as any).autoStartTime || undefined,
        repeatMode: (collection.repeatMode || DEFAULT_REPEAT_MODE) as TelegramCollectionRepeatMode,
        maxFailuresBeforePause: collection.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE,
        postMode: 'selected',
        products: schedulerProducts,
      });
      await refreshRunningCollections({ silent: true });
      setNotice({ type: 'success', message: 'Collection started' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Backend not reachable' });
    } finally {
      setIsStartingCollection(false);
    }
  };

  const startCollectionRun = async () => {
    if (!collectionProducts.length) {
      setNotice({ type: 'error', message: 'Add at least one product before starting a collection.' });
      return;
    }
    const missingImageProduct = collectionProducts.find((product) => !getProductImageUrl(product));
    if (missingImageProduct) {
      setNotice({ type: 'error', message: 'Product missing image.' });
      return;
    }

    setIsStartingCollection(true);
    setNotice({ type: 'info', message: 'Starting Telegram collection...' });
    try {
      requireTelegramChannelId();
      const savedCollection = await ensureCollectionSaved();
      const schedulerProducts = buildSchedulerProducts(collectionProducts);
      await startTelegramCollection({
        id: savedCollection.id,
        collectionId: savedCollection.id,
        name: savedCollection.name,
        channelId: savedCollection.channelId,
        template: savedCollection.template,
        notes: savedCollection.notes,
        category: savedCollection.category,
        frequencyValue: savedCollection.frequencyValue || DEFAULT_FREQUENCY_VALUE,
        frequencyUnit: (savedCollection.frequencyUnit || DEFAULT_FREQUENCY_UNIT) as TelegramCollectionFrequencyUnit,
        batchSize: (savedCollection as any).batchSize || DEFAULT_BATCH_SIZE,
        autoStartTime: (savedCollection as any).autoStartTime || undefined,
        repeatMode: (savedCollection.repeatMode || DEFAULT_REPEAT_MODE) as TelegramCollectionRepeatMode,
        maxFailuresBeforePause: savedCollection.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE,
        postMode: 'selected',
        products: schedulerProducts,
      });
      await refreshRunningCollections({ silent: true });
      setNotice({ type: 'success', message: 'Collection started' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Backend not reachable' });
    } finally {
      setIsStartingCollection(false);
    }
  };

  const sendPosts = async () => {
    if (!targetProducts.length) {
      setNotice({ type: 'error', message: 'No products are ready to post for the current mode.' });
      return;
    }
    const missingImageProduct = targetProducts.find((product) => !getProductImageUrl(product));
    if (missingImageProduct) {
      setNotice({ type: 'error', message: 'Product missing image.' });
      return;
    }
    setIsSending(true);
    setNotice({ type: 'info', message: 'Sending Telegram posts...' });
    let successCount = 0;
    const failures: string[] = [];
    try {
      const channelId = requireTelegramChannelId();
      for (const product of targetProducts) {
        try {
          await createTelegramProductPost({
            channelId,
            product: {
              id: product.id,
              name: getProductName(product),
              price: toNonNegativeNumber(product.sellPrice || product.buyPrice),
              image: getProductImageUrl(product),
              category: getProductCategory(product),
              stock: toNonNegativeNumber(product.stock),
            },
            template: telegramTemplate.trim() || DEFAULT_TEMPLATE,
            notes: telegramNotes.trim(),
          });
          successCount += 1;
        } catch (error) {
          failures.push(`${getProductName(product)}: ${getFriendlyErrorMessage(error, 'telegram.post')}`);
        }
      }
      const now = new Date().toISOString();
      const lastProductName = targetProducts[targetProducts.length - 1] ? getProductName(targetProducts[targetProducts.length - 1]) : '';
      const activityEntry: TelegramPostActivity = {
        id: `telegram-activity-${Date.now()}`,
        collectionId: activeCollection?.id || undefined,
        collectionName: activeCollection?.name || (collectionName.trim() || undefined),
        category: categoryFilter,
        channelId,
        postMode,
        productCount: targetProducts.length,
        successCount,
        failureCount: failures.length,
        postedAt: now,
        lastPostedProductName: lastProductName || undefined,
      };
      const nextActivity = [activityEntry, ...telegramActivity].slice(0, MAX_ACTIVITY_ENTRIES);
      const nextCollections = activeCollection
        ? telegramCollections.map((collection) => collection.id === activeCollection.id ? {
            ...collection,
            updatedAt: now,
            lastPostedAt: now,
            lastPostedProductName: lastProductName || collection.lastPostedProductName,
            totalPostsSent: toNonNegativeNumber(collection.totalPostsSent) + successCount,
          } : collection)
        : telegramCollections;
      await persistTelegramProfile({
        telegramPostActivity: nextActivity,
        telegramCollections: nextCollections,
      }, { suppressNotice: true });
      if (!failures.length) {
        setNotice({ type: 'success', message: `${successCount} Telegram post${successCount === 1 ? '' : 's'} sent successfully.` });
      } else {
        setNotice({ type: 'error', message: `${successCount} sent, ${failures.length} failed. ${failures.slice(0, 3).join(' | ')}` });
      }
    } catch (error) {
      setNotice({ type: 'error', message: getFriendlyErrorMessage(error, 'telegram.post_batch') });
    } finally {
      setIsSending(false);
    }
  };

  const unsavedGlobalSettings = (
    telegramChannelId !== safeText(profile?.telegramChannelId)
    || telegramTemplate !== safeText(profile?.telegramTemplate, DEFAULT_TEMPLATE)
    || telegramNotes !== safeText(profile?.telegramNotes)
  );

  const noticeClassName = notice?.type === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : notice?.type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-20 md:pb-0">
      {notice && <div className={`rounded-lg border px-3 py-2 text-sm ${noticeClassName}`}>{notice.message}</div>}

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base tracking-wide uppercase text-slate-700">Telegram Channels</CardTitle>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2">
            <Input value={newChannelId} onChange={(event) => setNewChannelId(event.target.value)} placeholder="@stockflow_offers" />
            <Button type="button" onClick={() => void addTelegramChannel()}>
              <Plus className="mr-2 h-4 w-4" /> Add Channel
            </Button>
          </div>
        </CardHeader>
      </Card>

      {savedChannels.length > 0 && (
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-2">
              {savedChannels.map((channelId) => (
                <button
                  key={channelId}
                  type="button"
                  onClick={() => setSelectedChannelId(channelId)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    selectedChannelId === channelId
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {channelId}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardContent className="space-y-5">
          {savedChannels.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No Telegram channels added yet. Add a channel ID to start creating collections.
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-bold text-slate-950">{selectedChannelId}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {activeChannelSavedCollections.length} saved collection{activeChannelSavedCollections.length === 1 ? '' : 's'} • {activeChannelRunningCollections.length} running
                    </div>
                  </div>
                  <Button type="button" size="sm" onClick={() => openCollectionModal(selectedChannelId)}>
                    <FolderPlus className="mr-2 h-4 w-4" /> Add Collection
                  </Button>
                </div>
                <div className="space-y-2">
                  {activeChannelSavedCollections.length > 0 ? activeChannelSavedCollections.map((collection) => {
                    const liveCollection = runningCollectionsBySavedId.get(collection.id);
                    const normalizedStatus = safeText(liveCollection?.status).toLowerCase();
                    const isRunning = normalizedStatus === 'running';
                    const isPaused = normalizedStatus === 'paused';
                    const actionCollectionId = safeText(liveCollection?.collectionId || liveCollection?.id || collection.id);
                    return (
                      <div key={collection.id} className="rounded-xl border bg-white px-4 py-3">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate font-semibold text-slate-950">{collection.name}</div>
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${isRunning ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : isPaused ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                {isRunning ? 'Running' : isPaused ? 'Paused' : 'Saved'}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                              <span>{collection.category === 'all' ? 'All categories' : collection.category}</span>
                              <span>{collection.queuedProductIds.length} queued</span>
                              <span>{collection.frequencyValue || DEFAULT_FREQUENCY_VALUE} {collection.frequencyUnit || DEFAULT_FREQUENCY_UNIT}</span>
                              <span>Batch {(collection as any).batchSize || DEFAULT_BATCH_SIZE}</span>
                              {liveCollection ? <span>Sent {liveCollection.sentCount}</span> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!isRunning && !isPaused && (
                              <Button type="button" size="sm" onClick={() => void startSavedCollectionRun(collection)} disabled={isStartingCollection}>
                                <Play className="mr-2 h-4 w-4" /> Start
                              </Button>
                            )}
                            {isRunning && liveCollection && (
                              <Button type="button" size="sm" variant="outline" onClick={() => void handleCollectionAction('pause', liveCollection, () => pauseTelegramCollection(actionCollectionId), 'Collection paused')} disabled={collectionActionId === actionCollectionId}>
                                <Pause className="mr-2 h-4 w-4" /> Pause
                              </Button>
                            )}
                            {isPaused && liveCollection && (
                              <Button type="button" size="sm" variant="outline" onClick={() => void handleCollectionAction('resume', liveCollection, () => resumeTelegramCollection(actionCollectionId), 'Collection resumed')} disabled={collectionActionId === actionCollectionId}>
                                <Play className="mr-2 h-4 w-4" /> Start
                              </Button>
                            )}
                            {(isRunning || isPaused) && liveCollection && (
                              <Button type="button" size="sm" variant="outline" onClick={() => void handleCollectionAction('stop', liveCollection, () => stopTelegramCollection(actionCollectionId), 'Collection stopped')} disabled={collectionActionId === actionCollectionId}>
                                <Square className="mr-2 h-4 w-4" /> Stop
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" onClick={() => openCollectionModal(selectedChannelId, collection.id)}>
                              Edit
                            </Button>
                            {liveCollection && (
                              <Button type="button" size="sm" variant="outline" onClick={() => void loadActivityForCollection(actionCollectionId)} disabled={isActivityLoading && selectedActivityCollectionId === actionCollectionId}>
                                View Activity
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" className="text-rose-600" onClick={() => void deleteCollectionById(collection.id)} disabled={isSavingCollection}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No collections saved for this channel yet.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base tracking-wide uppercase text-slate-700">Running Collections</CardTitle>
            <p className="text-sm text-muted-foreground">Live collection activity for the currently selected Telegram channel.</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{savedChannels.length} channels</span>
            <span>{visibleRunningCollections.length} live collections</span>
            <span>{livePostedCount} posts sent</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {hiddenForeignRunningCollectionsCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Hidden {hiddenForeignRunningCollectionsCount} live collection{hiddenForeignRunningCollectionsCount === 1 ? '' : 's'} that do not belong to this store profile.
            </div>
          )}
          {savedChannels.length > 0 && selectedChannelId ? (
            <div className="rounded-2xl border bg-white p-5">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-950">{selectedChannelId}</div>
                  <div className="mt-1 text-sm text-slate-600">{activeChannelSavedCollections.length} saved collection{activeChannelSavedCollections.length === 1 ? '' : 's'} • {activeChannelRunningCollections.length} currently running</div>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {activeChannelRunningCollections.length > 0 ? activeChannelRunningCollections.map((collection) => {
                  const backendCollectionId = safeText(collection.collectionId || collection.id);
                  const normalizedStatus = safeText(collection.status).toLowerCase();
                  const isRunning = normalizedStatus === 'running';
                  const isPaused = normalizedStatus === 'paused';
                  return (
                    <div key={collection.id} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="text-lg font-bold text-slate-950">{collection.name}</div>
                          <div className="text-sm text-slate-600">{collection.category === 'all' ? 'All categories' : collection.category} • {collection.frequencyValue} {collection.frequencyUnit}</div>
                          <div className="inline-flex rounded-full border bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            {collection.status}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isRunning && (
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('pause', collection, () => pauseTelegramCollection(backendCollectionId), 'Collection paused')} disabled={collectionActionId === backendCollectionId}>
                              <Pause className="mr-2 h-4 w-4" /> Pause
                            </Button>
                          )}
                          {isPaused && (
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('resume', collection, () => resumeTelegramCollection(backendCollectionId), 'Collection resumed')} disabled={collectionActionId === backendCollectionId}>
                              <Play className="mr-2 h-4 w-4" /> Resume
                            </Button>
                          )}
                          <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('stop', collection, () => stopTelegramCollection(backendCollectionId), 'Collection stopped')} disabled={collectionActionId === backendCollectionId}>
                            <Square className="mr-2 h-4 w-4" /> Stop
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => openCollectionModal(selectedChannelId, backendCollectionId)}>
                            Edit Setup
                          </Button>
                          <Button type="button" size="sm" onClick={() => void loadActivityForCollection(backendCollectionId)} disabled={isActivityLoading && selectedActivityCollectionId === backendCollectionId}>
                            View Activity
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Products</div><div className="mt-1 font-bold text-slate-900">{collection.productsCount}</div></div>
                        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Cursor</div><div className="mt-1 font-bold text-slate-900">{collection.currentCursor}</div></div>
                        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Sent</div><div className="mt-1 font-bold text-slate-900">{collection.sentCount}</div></div>
                        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Failed</div><div className="mt-1 font-bold text-slate-900">{collection.failedCount}</div></div>
                        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Repeat</div><div className="mt-1 font-bold text-slate-900">{collection.repeatMode || 'loop'}</div></div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border bg-white p-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Last Posted Product</div>
                          <div className="mt-1 font-semibold text-slate-900">{collection.lastPostedProduct || 'Not yet'}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDateTime(collection.lastPostedAt)}</div>
                        </div>
                        <div className="rounded-xl border bg-white p-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Next Post Time</div>
                          <div className="mt-1 font-semibold text-slate-900">{formatDateTime(collection.nextPostAt)}</div>
                          <div className="mt-1 text-xs text-slate-500">Max failures before pause: {collection.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE}</div>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No collections are running on this channel right now.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add a channel first to start organizing Telegram collections.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="hidden">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base tracking-wide uppercase text-slate-700">Telegram Channels</CardTitle>
            <p className="text-sm text-muted-foreground">Add channels first. Each channel can hold multiple collections, and collection setup opens only inside the popup.</p>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2">
            <Input value={newChannelId} onChange={(event) => setNewChannelId(event.target.value)} placeholder="@stockflow_offers" />
            <Button type="button" onClick={() => void addTelegramChannel()}>
              <Plus className="mr-2 h-4 w-4" /> Add Channel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {savedChannels.map((channelId) => {
            const collectionsForChannel = telegramCollections.filter((collection) => safeText(collection.channelId) === safeText(channelId));
            const runningForChannel = visibleRunningCollections.filter((collection) => safeText(collection.channelId) === safeText(channelId));
            return (
              <div key={channelId} className={`rounded-2xl border p-4 transition ${selectedChannelId === channelId ? 'border-slate-900 bg-slate-50' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold text-slate-950">{channelId}</div>
                    <div className="mt-1 text-sm text-slate-600">{collectionsForChannel.length} saved collection{collectionsForChannel.length === 1 ? '' : 's'} • {runningForChannel.length} running</div>
                  </div>
                  <button type="button" className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100" onClick={() => setSelectedChannelId(channelId)}>
                    Select
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => openCollectionModal(channelId)}>
                    <FolderPlus className="mr-2 h-4 w-4" /> New Collection
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openCollectionModal(channelId, collectionsForChannel[0]?.id)}
                    disabled={collectionsForChannel.length === 0}
                  >
                    Manage Collections
                  </Button>
                </div>
              </div>
            );
          })}
          {savedChannels.length === 0 && (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
              No Telegram channels added yet. Add a channel ID to start creating collections.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="hidden">
        <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base tracking-wide uppercase text-slate-700">Running Collections By Channel</CardTitle>
            <p className="text-sm text-muted-foreground">The page outside the popup now focuses only on live running collections grouped channel-wise.</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{savedChannels.length} channels</span>
            <span>{visibleRunningCollections.length} live collections</span>
            <span>{livePostedCount} posts sent</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {hiddenForeignRunningCollectionsCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Hidden {hiddenForeignRunningCollectionsCount} live collection{hiddenForeignRunningCollectionsCount === 1 ? '' : 's'} that do not belong to this store profile.
            </div>
          )}
          {savedChannels.map((channelId) => {
            const channelRunningCollections = visibleRunningCollections.filter((collection) => safeText(collection.channelId) === safeText(channelId));
            const channelSavedCollections = telegramCollections.filter((collection) => safeText(collection.channelId) === safeText(channelId));
            return (
              <div key={channelId} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-bold text-slate-950">{channelId}</div>
                    <div className="mt-1 text-sm text-slate-600">{channelSavedCollections.length} saved collection{channelSavedCollections.length === 1 ? '' : 's'} • {channelRunningCollections.length} currently running</div>
                  </div>
                  <Button type="button" size="sm" onClick={() => openCollectionModal(channelId)}>
                    <FolderPlus className="mr-2 h-4 w-4" /> Create Collection
                  </Button>
                </div>
                <div className="mt-4 space-y-4">
                  {channelRunningCollections.length > 0 ? channelRunningCollections.map((collection) => {
                    const backendCollectionId = safeText(collection.collectionId || collection.id);
                    const normalizedStatus = safeText(collection.status).toLowerCase();
                    const isRunning = normalizedStatus === 'running';
                    const isPaused = normalizedStatus === 'paused';
                    return (
                      <div key={collection.id} className="rounded-2xl border bg-slate-50 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="text-lg font-bold text-slate-950">{collection.name}</div>
                            <div className="text-sm text-slate-600">{collection.category === 'all' ? 'All categories' : collection.category} • {collection.frequencyValue} {collection.frequencyUnit}</div>
                            <div className="inline-flex rounded-full border bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                              {collection.status}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {isRunning && (
                              <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('pause', collection, () => pauseTelegramCollection(backendCollectionId), 'Collection paused')} disabled={collectionActionId === backendCollectionId}>
                                <Pause className="mr-2 h-4 w-4" /> Pause
                              </Button>
                            )}
                            {isPaused && (
                              <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('resume', collection, () => resumeTelegramCollection(backendCollectionId), 'Collection resumed')} disabled={collectionActionId === backendCollectionId}>
                                <Play className="mr-2 h-4 w-4" /> Resume
                              </Button>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleCollectionAction('stop', collection, () => stopTelegramCollection(backendCollectionId), 'Collection stopped')} disabled={collectionActionId === backendCollectionId}>
                              <Square className="mr-2 h-4 w-4" /> Stop
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openCollectionModal(channelId, backendCollectionId)}>
                              Edit Setup
                            </Button>
                            <Button type="button" size="sm" onClick={() => void loadActivityForCollection(backendCollectionId)} disabled={isActivityLoading && selectedActivityCollectionId === backendCollectionId}>
                              View Activity
                            </Button>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                          <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Products</div><div className="mt-1 font-bold text-slate-900">{collection.productsCount}</div></div>
                          <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Cursor</div><div className="mt-1 font-bold text-slate-900">{collection.currentCursor}</div></div>
                          <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Sent</div><div className="mt-1 font-bold text-slate-900">{collection.sentCount}</div></div>
                          <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Failed</div><div className="mt-1 font-bold text-slate-900">{collection.failedCount}</div></div>
                          <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Repeat</div><div className="mt-1 font-bold text-slate-900">{collection.repeatMode || 'loop'}</div></div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border bg-white p-3 text-sm">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Last Posted Product</div>
                            <div className="mt-1 font-semibold text-slate-900">{collection.lastPostedProduct || 'Not yet'}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatDateTime(collection.lastPostedAt)}</div>
                          </div>
                          <div className="rounded-xl border bg-white p-3 text-sm">
                            <div className="text-xs uppercase tracking-wide text-slate-500">Next Post Time</div>
                            <div className="mt-1 font-semibold text-slate-900">{formatDateTime(collection.nextPostAt)}</div>
                            <div className="mt-1 text-xs text-slate-500">Max failures before pause: {collection.maxFailuresBeforePause || DEFAULT_MAX_FAILURES_BEFORE_PAUSE}</div>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No collections are running on this channel right now.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {savedChannels.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add a channel first to start organizing Telegram collections.
            </div>
          )}
        </CardContent>
      </Card>

      {isCollectionModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-[1500px] overflow-hidden rounded-3xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <div className="text-lg font-bold text-slate-950">{activeCollection ? 'Edit Telegram Collection' : 'Create Telegram Collection'}</div>
                <div className="text-sm text-slate-600">All collection creation stays inside this popup. The main page remains channel and running-collection focused.</div>
              </div>
              <button type="button" className="rounded-full border p-2 text-slate-600 transition hover:bg-slate-100" onClick={() => setIsCollectionModalOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid xl:grid-cols-[minmax(0,1.2fr)_380px]">
              <div className="max-h-[calc(92vh-76px)] overflow-y-auto p-6">
                <div className="space-y-6">
                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base tracking-wide uppercase text-slate-700">Collection Setup</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-1">
                        <div className="space-y-2">
                          <Label>Collection Name</Label>
                          <Input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="e.g. Weekend Home Offers" />
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <div className="space-y-2">
                          <Label>Frequency Value</Label>
                          <Input
                            type="number"
                            min={frequencyUnit === 'seconds' ? String(MIN_TELEGRAM_SECONDS_INTERVAL) : '1'}
                            value={frequencyValue}
                            onChange={(event) => setFrequencyValue(event.target.value)}
                            placeholder={frequencyUnit === 'seconds' ? String(MIN_TELEGRAM_SECONDS_INTERVAL) : '1'}
                          />
                          {frequencyUnit === 'seconds' && (
                            <p className="text-xs text-muted-foreground">Minimum {MIN_TELEGRAM_SECONDS_INTERVAL} seconds.</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>Frequency Unit</Label>
                          <Select value={frequencyUnit} onChange={(event) => setFrequencyUnit(event.target.value as TelegramCollectionFrequencyUnit)}>
                            <option value="seconds">Seconds</option>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Batch Size</Label>
                          <Select value={batchSize} onChange={(event) => setBatchSize(event.target.value)}>
                            <option value="2">2 products</option>
                            <option value="4">4 products</option>
                            <option value="6">6 products</option>
                            <option value="8">8 products</option>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Repeat Mode</Label>
                          <Select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as TelegramCollectionRepeatMode)}>
                            <option value="once">Once</option>
                            <option value="loop">Loop</option>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Auto Start Time</Label>
                          <Input type="time" value={autoStartTime} onChange={(event) => setAutoStartTime(event.target.value)} />
                          <p className="text-xs text-muted-foreground">Optional daily start time for this collection.</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Max Failures Before Pause</Label>
                          <Input type="number" min="1" value={maxFailuresBeforePause} onChange={(event) => setMaxFailuresBeforePause(event.target.value)} placeholder="3" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base tracking-wide uppercase text-slate-700">Content</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Text Template</Label>
                        <textarea value={telegramTemplate} onChange={(event) => setTelegramTemplate(event.target.value)} rows={7} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                        <p className="text-xs text-muted-foreground">{'Use {product_name}, {price}, {category}, {stock}, {barcode}'}</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Notes</Label>
                        <Input value={telegramNotes} onChange={(event) => setTelegramNotes(event.target.value)} placeholder="Optional footer or campaign notes" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base tracking-wide uppercase text-slate-700">Products</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                        <div className="relative">
                          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                          <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search products, barcode, category..." className="pl-9" />
                        </div>
                        <Select value={categoryFilter} onChange={(event) => {
                          const nextCategory = event.target.value;
                          setCategoryFilter(nextCategory);
                          setCollectionCategory(nextCategory);
                        }}>
                          {filterCategories.map((category) => <option key={category} value={category}>{category === 'all' ? 'All Categories' : category}</option>)}
                        </Select>
                        <Select value={sortOption} onChange={(event) => setSortOption(event.target.value as typeof sortOption)}>
                          <option value="name-asc">Name (A-Z)</option>
                          <option value="stock-desc">Stock High-Low</option>
                          <option value="stock-asc">Stock Low-High</option>
                          <option value="price-desc">Price High-Low</option>
                          <option value="price-asc">Price Low-High</option>
                        </Select>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                        <div className="rounded-2xl border bg-white">
                          <div className="flex items-center justify-between border-b px-4 py-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">Available Products</div>
                              <div className="text-xs text-muted-foreground">Browse inventory and add products into this collection queue.</div>
                            </div>
                            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{filteredProducts.length} found</div>
                          </div>
                          <div className="max-h-[520px] overflow-auto">
                            {filteredProducts.map((product) => {
                              const inQueue = queuedProductIds.includes(product.id);
                              return (
                                <div key={product.id} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 border-b px-4 py-3">
                                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
                                    {getProductImageUrl(product)
                                      ? <img src={getProductImageUrl(product)} alt={getProductName(product)} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                      : <ImageIcon className="h-5 w-5 text-slate-300" />}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-900">{getProductName(product)}</div>
                                    <div className="truncate text-xs text-muted-foreground">{getProductBarcode(product)} • {getProductCategory(product)}</div>
                                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-600">
                                      <span>Stock {toNonNegativeNumber(product.stock)}</span>
                                      <span>{formatCurrency(toNonNegativeNumber(product.sellPrice || product.buyPrice))}</span>
                                    </div>
                                  </div>
                                  <Button type="button" variant={inQueue ? 'secondary' : 'outline'} size="sm" onClick={() => addProductToQueue(product.id)} disabled={inQueue}>
                                    <Plus className="mr-1 h-4 w-4" /> {inQueue ? 'Added' : 'Add'}
                                  </Button>
                                </div>
                              );
                            })}
                            {filteredProducts.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No products match the current filters.</div>}
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="rounded-2xl border bg-slate-50 p-4 text-sm">
                            <div>Filtered products: <span className="font-semibold">{filteredProducts.length}</span></div>
                            <div>Selected queue: <span className="font-semibold">{queuedProducts.length}</span></div>
                            <div>Will send now: <span className="font-semibold">{targetProducts.length}</span></div>
                          </div>
                          <div className="rounded-2xl border bg-white">
                            <div className="flex items-center justify-between border-b px-4 py-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">Selected Product Queue</div>
                                <div className="text-xs text-muted-foreground">Only queued products from this list will be sent.</div>
                              </div>
                              <Button type="button" variant="outline" size="sm" onClick={clearQueue} disabled={queuedProducts.length === 0}>
                                Clear
                              </Button>
                            </div>
                            <div className="p-4">
                              <div className="relative mb-3">
                                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                                <Input value={queueSearchTerm} onChange={(event) => setQueueSearchTerm(event.target.value)} placeholder="Search queued products" className="pl-9" />
                              </div>
                              <div className="max-h-[380px] space-y-3 overflow-auto">
                                {queueFilteredProducts.map((product) => (
                                  <div key={product.id} className="flex items-center gap-3 rounded-xl border p-3">
                                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
                                      {getProductImageUrl(product)
                                        ? <img src={getProductImageUrl(product)} alt={getProductName(product)} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                        : <ImageIcon className="h-5 w-5 text-slate-300" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-semibold text-slate-900">{getProductName(product)}</div>
                                      <div className="truncate text-xs text-muted-foreground">{getProductBarcode(product)} • {getProductCategory(product)}</div>
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={() => removeProductFromQueue(product.id)}>
                                      <Trash2 className="mr-1 h-4 w-4" /> Remove
                                    </Button>
                                  </div>
                                ))}
                                {queueFilteredProducts.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No products in the selected queue yet.</div>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
              <div className="max-h-[calc(92vh-76px)] overflow-y-auto border-l bg-slate-50/70 p-6">
                <div className="space-y-6">
                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base tracking-wide uppercase text-slate-700">Preview</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {previewProduct ? (
                        <>
                          <div className="overflow-hidden rounded-2xl border bg-white">
                            {getProductImageUrl(previewProduct)
                              ? <img src={getProductImageUrl(previewProduct)} alt={getProductName(previewProduct)} className="h-64 w-full object-cover" loading="lazy" decoding="async" />
                              : <div className="flex h-64 items-center justify-center bg-slate-50"><ImageIcon className="h-10 w-10 text-slate-300" /></div>}
                          </div>
                          <div className="text-2xl font-bold text-slate-950">{getProductName(previewProduct)}</div>
                          <div className="whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm text-slate-700">{buildCaption(previewProduct)}</div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Add products to the queue or widen the filters to generate a preview.</div>
                      )}
                      <div className="space-y-2">
                        <Button type="button" className="h-11 w-full" onClick={() => void saveCollection()} disabled={isSavingCollection}>
                          <Save className="mr-2 h-4 w-4" />
                          {isSavingCollection ? 'Saving...' : activeCollection ? 'Update Collection' : 'Save Collection'}
                        </Button>
                        <Button type="button" className="h-11 w-full" onClick={() => void startCollectionRun()} disabled={isStartingCollection || targetProducts.length === 0}>
                          <Play className="mr-2 h-4 w-4" />
                          {isStartingCollection ? 'Starting Collection...' : 'Start Collection'}
                        </Button>
                        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => void sendPosts()} disabled={isSending || targetProducts.length === 0}>
                          <Send className="mr-2 h-4 w-4" />
                          {isSending ? 'Sending Test Post...' : 'Send One Test Post'}
                        </Button>
                        {activeCollection && (
                          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => void deleteCollection()} disabled={isSavingCollection}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete Collection
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base tracking-wide uppercase text-slate-700">Activity</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border bg-white p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Posts sent</div>
                          <div className="mt-1 text-xl font-bold text-slate-950">{Math.max(totalPostedCount, livePostedCount)}</div>
                        </div>
                        <div className="rounded-xl border bg-white p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last posted product</div>
                          <div className="mt-1 text-sm font-bold text-slate-950">{lastPostedEntry?.lastPostedProductName || 'Not yet'}</div>
                        </div>
                      </div>
                      <div className="rounded-xl border bg-white p-3 text-sm">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <Clock3 className="h-4 w-4" />
                          Last activity
                        </div>
                        <div className="mt-2 text-slate-700">
                          {lastPostedEntry ? (
                            <>
                              <div>{lastPostedEntry.collectionName || 'Quick post'} • {lastPostedEntry.successCount}/{lastPostedEntry.productCount} sent</div>
                              <div className="text-xs text-muted-foreground">{lastPostedEntry.lastPostedProductName || 'Product not captured'} • {lastPostedEntry.category === 'all' ? 'All categories' : lastPostedEntry.category}</div>
                            </>
                          ) : (
                            <div className="text-muted-foreground">No posts have been sent yet.</div>
                          )}
                        </div>
                      </div>
                      {selectedCollectionActivity.length > 0 && (
                        <div className="space-y-3">
                          <div className="text-sm font-semibold text-slate-900">Recent Activity</div>
                          {selectedCollectionActivity.slice(0, 6).map((entry) => (
                            <div key={entry.id} className="rounded-xl border bg-white p-3 text-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-slate-900">{entry.productName || entry.collectionName || 'Telegram item'}</div>
                                  <div className="text-xs text-slate-500">{entry.status || 'unknown'}</div>
                                </div>
                                <div className="text-right text-xs text-slate-500">{formatDateTime(entry.postedAt || entry.createdAt || entry.updatedAt)}</div>
                              </div>
                              {entry.error && <div className="mt-2 text-xs text-red-600">{entry.error}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-slate-900">Failed Products</div>
                        {failedProducts.slice(0, 6).map((entry) => (
                          <div key={entry.id} className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                            <div className="font-semibold">{entry.productName || 'Unknown product'}</div>
                            <div className="mt-1 text-xs">{entry.error}</div>
                          </div>
                        ))}
                        {failedProducts.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No failed products in the selected activity feed.</div>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-20 md:pb-0">
      {notice && <div className={`rounded-lg border px-3 py-2 text-sm ${noticeClassName}`}>{notice.message}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">Running Collections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hiddenForeignRunningCollectionsCount > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Hidden {hiddenForeignRunningCollectionsCount} live collection{hiddenForeignRunningCollectionsCount === 1 ? '' : 's'} that do not belong to this store profile.
                </div>
              )}
              {visibleRunningCollections.length > 0 ? (
                <div className="grid gap-4">
                  {visibleRunningCollections.map((collection) => {
                    const backendCollectionId = safeText(collection.collectionId || collection.id);
                    const normalizedStatus = safeText(collection.status).toLowerCase();
                    const isRunning = normalizedStatus === 'running';
                    const isPaused = normalizedStatus === 'paused';
                    return (
                    <div key={collection.id} className="rounded-2xl border bg-white p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="text-lg font-bold text-slate-950">{collection.name}</div>
                          <div className="text-sm text-slate-600">{collection.channelId || 'No channel'} • {collection.category === 'all' ? 'All categories' : collection.category}</div>
                          <div className="inline-flex rounded-full border bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            {collection.status}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isRunning && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleCollectionAction('pause', collection, () => pauseTelegramCollection(backendCollectionId), 'Collection paused')}
                              disabled={collectionActionId === backendCollectionId}
                            >
                              <Pause className="mr-2 h-4 w-4" /> Pause
                            </Button>
                          )}
                          {isPaused && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void handleCollectionAction('resume', collection, () => resumeTelegramCollection(backendCollectionId), 'Collection resumed')}
                              disabled={collectionActionId === backendCollectionId}
                            >
                              <Play className="mr-2 h-4 w-4" /> Resume
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleCollectionAction('stop', collection, () => stopTelegramCollection(backendCollectionId), 'Collection stopped')}
                            disabled={collectionActionId === backendCollectionId}
                          >
                            <Square className="mr-2 h-4 w-4" /> Stop
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void loadActivityForCollection(backendCollectionId)}
                            disabled={isActivityLoading && selectedActivityCollectionId === backendCollectionId}
                          >
                            View Activity
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Products</div><div className="mt-1 font-bold text-slate-900">{collection.productsCount}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Current Cursor</div><div className="mt-1 font-bold text-slate-900">{collection.currentCursor}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Sent Count</div><div className="mt-1 font-bold text-slate-900">{collection.sentCount}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Failed Count</div><div className="mt-1 font-bold text-slate-900">{collection.failedCount}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm"><div className="text-xs uppercase tracking-wide text-slate-500">Frequency</div><div className="mt-1 font-bold text-slate-900">{collection.frequencyValue} {collection.frequencyUnit}</div></div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Last Posted Product</div>
                          <div className="mt-1 font-semibold text-slate-900">{collection.lastPostedProduct || 'Not yet'}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDateTime(collection.lastPostedAt)}</div>
                        </div>
                        <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Next Post Time</div>
                          <div className="mt-1 font-semibold text-slate-900">{formatDateTime(collection.nextPostAt)}</div>
                          <div className="mt-1 text-xs text-slate-500">Repeat mode: {collection.repeatMode || 'loop'}</div>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No live collections yet. Start a collection below to see automatic posting status here.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-sky-100 bg-sky-50/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">Collection Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_180px_180px]">
                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Currently Serving</div>
                  <div className="mt-1 text-lg font-bold text-slate-950">{activeCollection?.name || 'No active collection selected'}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {activeCollection
                      ? `${activeCollection.category === 'all' ? 'All categories' : activeCollection.category} • ${activeCollection.postMode.replace(/_/g, ' ')}`
                      : 'Choose a saved collection below or create a new one.'}
                  </div>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Collections</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{telegramCollections.length}</div>
                  <div className="mt-1 text-sm text-slate-600">Reusable channel and queue setups</div>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live Catalog</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{livePostedCount}</div>
                  <div className="mt-1 text-sm text-slate-600">Posts sent by live collections</div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
                <div className="space-y-2">
                  <Label>Open Saved Collection</Label>
                  <Select value={activeCollectionId} onChange={(event) => loadCollection(event.target.value)}>
                    <option value="">Select saved collection</option>
                    {telegramCollections.map((collection) => (
                      <option key={collection.id} value={collection.id}>{collection.name} ({collection.category})</option>
                    ))}
                  </Select>
                </div>
                <div className="rounded-xl border bg-white p-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtered</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{filteredProducts.length}</div>
                </div>
                <div className="rounded-xl border bg-white p-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Queued</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{queuedProducts.length}</div>
                </div>
                <div className="rounded-xl border bg-white p-4 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Will Send</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{targetProducts.length}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">1. Post Type</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base tracking-wide uppercase text-slate-700">2. Content</CardTitle>
                <p className="text-sm text-muted-foreground">Default Telegram settings are saved once and can be reused or overridden per collection.</p>
              </div>
              <Button type="button" onClick={() => void saveTelegramSettings()} disabled={isSavingSettings || !unsavedGlobalSettings}>
                <Save className="mr-2 h-4 w-4" />
                {isSavingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Telegram Channel ID</Label>
                <Input value={telegramChannelId} onChange={(event) => setTelegramChannelId(event.target.value)} placeholder="@stockflow_offers" />
              </div>
              <div className="space-y-2">
                <Label>Text Template</Label>
                <textarea value={telegramTemplate} onChange={(event) => setTelegramTemplate(event.target.value)} rows={7} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                <p className="text-xs text-muted-foreground">{'Use {product_name}, {price}, {category}, {stock}, {barcode}'}</p>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={telegramNotes} onChange={(event) => setTelegramNotes(event.target.value)} placeholder="Optional footer or campaign notes" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base tracking-wide uppercase text-slate-700">3. Collections</CardTitle>
                <p className="text-sm text-muted-foreground">Create reusable Telegram collections with saved category, queue, channel, post mode, and update timestamps.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={createFreshCollectionDraft}>
                  <FolderPlus className="mr-2 h-4 w-4" /> New
                </Button>
                <Button type="button" onClick={() => void saveCollection()} disabled={isSavingCollection}>
                  {isSavingCollection ? 'Saving...' : activeCollection ? 'Update Collection' : 'Create Collection'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-1">
                <div className="space-y-2">
                  <Label>Choose Collection</Label>
                  <Input value={activeCollection?.name || 'No saved collection selected'} readOnly className="bg-slate-50" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
                <div className="space-y-2">
                  <Label>Collection Name</Label>
                  <Input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="e.g. Home & Kitchen Offers" />
                </div>
                <div className="space-y-2">
                  <Label>Collection Channel ID</Label>
                  <Input
                    value={collectionChannelId}
                    onChange={(event) => setCollectionChannelId(event.target.value)}
                    placeholder="@stockflow_offers"
                  />
                  <p className="text-xs text-muted-foreground">Update and save this if the selected collection should post to a different Telegram channel.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Frequency Value</Label>
                  <Input
                    type="number"
                    min="1"
                    value={frequencyValue}
                    onChange={(event) => setFrequencyValue(event.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Frequency Unit</Label>
                  <Select value={frequencyUnit} onChange={(event) => setFrequencyUnit(event.target.value as TelegramCollectionFrequencyUnit)}>
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Repeat Mode</Label>
                  <Select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as TelegramCollectionRepeatMode)}>
                    <option value="once">Once</option>
                    <option value="loop">Loop</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Max Failures Before Pause</Label>
                  <Input
                    type="number"
                    min="1"
                    value={maxFailuresBeforePause}
                    onChange={(event) => setMaxFailuresBeforePause(event.target.value)}
                    placeholder="3"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Collections in category</div>
                  <div className="mt-1 text-xl font-bold text-slate-900">{categoryCollections.length}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(activeCollection?.createdAt)}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updated</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(activeCollection?.updatedAt)}</div>
                </div>
              </div>
              {activeCollection && (
                <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div>
                    <div className="font-semibold">{activeCollection.name}</div>
                    <div className="text-xs">Channel: {activeCollection.channelId || 'Not set'}</div>
                    <div className="text-xs">Last posted: {formatDateTime(activeCollection.lastPostedAt)}{activeCollection.lastPostedProductName ? ` • ${activeCollection.lastPostedProductName}` : ''}</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void deleteCollection()} disabled={isSavingCollection}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">4. Products Accessible</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                <div className="relative">
                  <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search products, barcode, category..." className="pl-9" />
                </div>
                <Select value={categoryFilter} onChange={(event) => {
                  const nextCategory = event.target.value;
                  setCategoryFilter(nextCategory);
                  setCollectionCategory(nextCategory);
                }}>
                  {filterCategories.map((category) => <option key={category} value={category}>{category === 'all' ? 'All Categories' : category}</option>)}
                </Select>
                <Select value={sortOption} onChange={(event) => setSortOption(event.target.value as typeof sortOption)}>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="stock-desc">Stock High-Low</option>
                  <option value="stock-asc">Stock Low-High</option>
                  <option value="price-desc">Price High-Low</option>
                  <option value="price-asc">Price Low-High</option>
                </Select>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
                <div className="rounded-2xl border bg-white">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Available Products</div>
                      <div className="text-xs text-muted-foreground">Browse inventory and add products into the selected collection queue.</div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{filteredProducts.length} found</div>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    {filteredProducts.map((product) => {
                      const inQueue = queuedProductIds.includes(product.id);
                      return (
                        <div key={product.id} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 border-b px-4 py-3">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
                            {getProductImageUrl(product)
                              ? <img src={getProductImageUrl(product)} alt={getProductName(product)} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                              : <ImageIcon className="h-5 w-5 text-slate-300" />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900">{getProductName(product)}</div>
                            <div className="truncate text-xs text-muted-foreground">{getProductBarcode(product)} • {getProductCategory(product)}</div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-slate-600">
                              <span>Stock {toNonNegativeNumber(product.stock)}</span>
                              <span>{formatCurrency(toNonNegativeNumber(product.sellPrice || product.buyPrice))}</span>
                            </div>
                          </div>
                          <Button type="button" variant={inQueue ? 'secondary' : 'outline'} size="sm" onClick={() => addProductToQueue(product.id)} disabled={inQueue}>
                            <Plus className="mr-1 h-4 w-4" /> {inQueue ? 'Added' : 'Add'}
                          </Button>
                        </div>
                      );
                    })}
                    {filteredProducts.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No products match the current filters.</div>}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border bg-slate-50 p-4 text-sm">
                    <div>Filtered products: <span className="font-semibold">{filteredProducts.length}</span></div>
                    <div>Selected queue: <span className="font-semibold">{queuedProducts.length}</span></div>
                    <div>Will send now: <span className="font-semibold">{targetProducts.length}</span></div>
                  </div>

                  <div className="rounded-2xl border bg-white">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Selected Product Queue</div>
                        <div className="text-xs text-muted-foreground">Only queued products from this list will be sent.</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={clearQueue} disabled={queuedProducts.length === 0}>
                        Clear
                      </Button>
                    </div>
                    <div className="p-4">
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                        <Input value={queueSearchTerm} onChange={(event) => setQueueSearchTerm(event.target.value)} placeholder="Search queued products" className="pl-9" />
                      </div>
                      <div className="max-h-[380px] space-y-3 overflow-auto">
                        {queueFilteredProducts.map((product) => (
                          <div key={product.id} className="flex items-center gap-3 rounded-xl border p-3">
                            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
                              {getProductImageUrl(product)
                                ? <img src={getProductImageUrl(product)} alt={getProductName(product)} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                : <ImageIcon className="h-5 w-5 text-slate-300" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-semibold text-slate-900">{getProductName(product)}</div>
                              <div className="truncate text-xs text-muted-foreground">{getProductBarcode(product)} • {getProductCategory(product)}</div>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => removeProductFromQueue(product.id)}>
                              <Trash2 className="mr-1 h-4 w-4" /> Remove
                            </Button>
                          </div>
                        ))}
                        {queueFilteredProducts.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No products in the selected queue yet.</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-8 xl:self-start">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">Post Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewProduct ? (
                <>
                  <div className="overflow-hidden rounded-2xl border bg-white">
                    {getProductImageUrl(previewProduct)
                      ? <img src={getProductImageUrl(previewProduct)} alt={getProductName(previewProduct)} className="h-64 w-full object-cover" loading="lazy" decoding="async" />
                      : <div className="flex h-64 items-center justify-center bg-slate-50"><ImageIcon className="h-10 w-10 text-slate-300" /></div>}
                  </div>
                  <div className="text-2xl font-bold text-slate-950">{getProductName(previewProduct)}</div>
                  <div className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">{buildCaption(previewProduct)}</div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Add products to the queue or widen the filters to generate a preview.</div>
              )}
              <div className="space-y-2">
                <Button type="button" className="h-11 w-full" onClick={() => void startCollectionRun()} disabled={isStartingCollection || targetProducts.length === 0}>
                  <Play className="mr-2 h-4 w-4" />
                  {isStartingCollection ? 'Starting Collection...' : 'Start Collection'}
                </Button>
                <Button type="button" variant="outline" className="h-11 w-full" onClick={() => void sendPosts()} disabled={isSending || targetProducts.length === 0}>
                  <Send className="mr-2 h-4 w-4" />
                  {isSending ? 'Sending Test Post...' : 'Send One Test Post'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-wide uppercase text-slate-700">5. Running Catalog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Posts sent</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{Math.max(totalPostedCount, livePostedCount)}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last posted product</div>
                  <div className="mt-1 text-sm font-bold text-slate-950">{lastPostedEntry?.lastPostedProductName || 'Not yet'}</div>
                </div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last posted time</div>
                <div className="mt-1 font-semibold text-slate-900">{formatDateTime(lastPostedEntry?.postedAt)}</div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Clock3 className="h-4 w-4" />
                  Last activity
                </div>
                <div className="mt-2 text-slate-700">
                  {lastPostedEntry ? (
                    <>
                      <div>{lastPostedEntry.collectionName || 'Quick post'} • {lastPostedEntry.successCount}/{lastPostedEntry.productCount} sent</div>
                      <div className="text-xs text-muted-foreground">{lastPostedEntry.lastPostedProductName || 'Product not captured'} • {lastPostedEntry.category === 'all' ? 'All categories' : lastPostedEntry.category}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No posts have been sent yet.</div>
                  )}
                </div>
              </div>
              {selectedActivityCollectionId && (
                <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">Selected Activity</div>
                    <div className="text-xs text-slate-500">{selectedActivityCollectionId}</div>
                  </div>
                  <div className="mt-2 text-slate-700">
                    {isActivityLoading ? 'Loading collection activity...' : `${selectedCollectionActivity.length} activity row${selectedCollectionActivity.length === 1 ? '' : 's'} loaded`}
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {recentActivity.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="rounded-xl border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{entry.collectionName || 'Quick post'}</div>
                        <div className="text-xs text-muted-foreground">{entry.category === 'all' ? 'All categories' : entry.category} • {entry.postMode.replace(/_/g, ' ')}</div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">{formatDateTime(entry.postedAt)}</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-700">
                      Sent: {entry.successCount} • Failed: {entry.failureCount} • Last: {entry.lastPostedProductName || 'n/a'}
                    </div>
                  </div>
                ))}
                {recentActivity.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Running catalog will appear here after the first Telegram post.</div>}
              </div>
              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-900">Failed Products</div>
                {failedProducts.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    <div className="font-semibold">{entry.productName || 'Unknown product'}</div>
                    <div className="mt-1 text-xs">{entry.error}</div>
                  </div>
                ))}
                {failedProducts.length === 0 && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No failed products in the selected activity feed.</div>}
              </div>
              {selectedCollectionActivity.length > 0 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-slate-900">Recent Activity</div>
                  {selectedCollectionActivity.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{entry.productName || entry.collectionName || 'Telegram item'}</div>
                          <div className="text-xs text-slate-500">{entry.status || 'unknown'}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500">{formatDateTime(entry.postedAt || entry.createdAt || entry.updatedAt)}</div>
                      </div>
                      {entry.error && <div className="mt-2 text-xs text-red-600">{entry.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
