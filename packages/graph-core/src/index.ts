export * from "./types";
export * from "./random";
export {
  ARMENIA_CITIES,
  CONTEXTS_BY_TOPIC,
  COUNTRY,
  DEFAULT_CONTEXTS,
  DEFAULT_GEO,
  GEO_OPTIONS,
  YEREVAN_DISTRICTS,
  contextsForTopic,
  geoLabel,
  isKnownGeo,
  type ContextOption,
  type GeoOptionGroup,
} from "./geoArmenia";
export {
  contextFromEvents,
  deriveJourneyStatus,
  deriveRecStates,
  describeJourneyEvent,
  journeyMatches,
  mergeJourneyContext,
  summarizeJourneyForAgent,
  type JourneyContext,
  type JourneyEvent,
  type JourneyEventKind,
  type JourneyRecState,
  type JourneyStatus,
} from "./journey";
export {
  pendingConfirm,
  trimTranscript,
  type AgentMessage,
  type AgentResume,
  type AgentStreamEvent,
  type AgentToolCall,
  type ResolvedMention,
} from "./agent";
export { cosineSimilarity, topicsWithinThreshold } from "./similarity";
export { haversineKm, type LatLng } from "./geo";
export { isOpenNow, weeklyHours, type DayHours } from "./hours";
export { buildDataset, sampleIds, newUserRoot } from "./seed";
export {
  computeRecommendations,
  recomputeVals,
  refreshDerived,
  DEFAULT_WEIGHTS,
  type SignalMaps,
  type BlendWeights,
  type RecommendOptions,
} from "./recommend";
export { inferEdgeType, addEdge, removeEdge, addMutualFriendship, addInviteEdge, createPost, acceptRecommendation, dismissRecommendation } from "./mutations";
export {
  EXTRACTION_SYSTEM_PROMPT,
  ingestThought,
  heuristicExtract,
} from "./extract";
export {
  LANGEXTRACT_PROMPT_DESCRIPTION,
  LANGEXTRACT_EXAMPLES,
  buildLangExtractPrompt,
  convertExtractionsToGraph,
  type LxExtraction,
  type LxExample,
  type LxResult,
} from "./langextract";
export {
  toGraph,
  computeCommunities,
  shortestPath,
  egoIds,
  visibleIds,
  commonNeighborIds,
  type VisibilityOpts,
  type PeekRegion,
} from "./analytics";
export {
  STARTING_BALANCE,
  BUY_TOKENS_AMOUNT,
  THOUGHT_REWARD,
  PROMOTION_REWARD,
  PROMOTION_PER_SUPPORTER,
  PEEK_BASE_COST,
  PEEK_RADIUS_STEP,
  peekCost,
  promotionReward,
  ensureWallet,
  spendTokens,
  earnTokens,
  buyTokens,
} from "./economy";
export {
  enrichExtractionWithSources,
  parseEnabledSourceProviders,
  resolveWikipediaSource,
  wikipediaLangForName,
} from "./sources";
export type { EntitySourceProvider } from "./sources";
export {
  ENTITY_LINK_PRESETS,
  ENTITY_LINK_PROMOTION_THRESHOLD,
  addUserEntityLink,
  entityLinkLabel,
  entityLinksForNode,
  isUserScopedLink,
  linksForViewer,
  viewForUser,
  removeUserEntityLink,
  type EntityLinkPreset,
  type EntityLinkType,
} from "./entityLinks";
export {
  NATS_SUBJECTS,
  upsertNode,
  upsertEdge,
  type NodeUpsertEvent,
  type EdgeUpsertEvent,
  type PlaceLinkSubmittedEvent,
  type PlaceLinkResolvedEvent,
} from "./events";
export { whoToMeet, matchPct, rankedSearch, type MeetSuggestion, type MeetMode, type MeetOptions, type SearchFilters, type SearchOptions, type RankedHit } from "./summitMatch";
export { materializeTags, tagConceptId } from "./summitGraph";
export {
  SUMMIT_EXTRACTION_SYSTEM_PROMPT,
  summitExtractionSystemPrompt,
  buildSummitLangExtractPrompt,
  summitHeuristicExtract,
  summitPrivacyHeuristic,
  coerceNotePrivacy,
  DEFAULT_NOTE_KINDS,
  type NotePrivacy,
} from "./summitExtract";
export {
  TOPIC_TAXONOMY,
  TOPIC_PARENT,
  REASON_TAXONOMY,
  UNIVERSAL_REASONS,
  TRUST_MAX_HOPS,
  TRUST_DECAY,
  TRUST_W_OUTCOME,
  reasonsForTopic,
  normalizeTopic,
  validateScope,
  addTrustEdge,
  removeTrustEdge,
  trustEdgesForNode,
  applyOutcomeToEdge,
  topicMatch,
  computeTrustRecommendations,
  type TrustQuery,
} from "./trust";
export {
  aggregateReputation,
  REPUTATION_DEFAULTS,
  type ReputationSample,
  type ReputationScore,
  type ReputationOptions,
} from "./reputation";
export {
  rankCandidates,
  explainRanking,
  RANKING_CONFIG,
  FORBIDDEN_SIGNALS,
  type RankingCandidate,
  type RankingFactor,
  type RankingResult,
  type RankingConfig,
} from "./ranking";
export {
  listenCapacity,
  addListenEdge,
  removeListenEdge,
  listeningTo,
  listenersOf,
  activeListenCount,
  isListening,
  listenSuggestions,
  recommendationsFromListened,
  LISTEN_DEFAULTS,
  type ListenCapacityConfig,
  type ListenSuggestion,
  type ListenSuggestOptions,
} from "./listen";
export {
  createRecommendation,
  attachOutcome,
  outcomesForRecommendation,
  recommendationsForTarget,
  recommendationConsensus,
  type RecommendationInput,
  type OutcomeInput,
  type RecommendationProps,
} from "./recommendations";
export {
  analyzeComposerText,
  applyMention,
  parseActiveMention,
  topicsInText,
  type ActiveMention,
  type ComposerAnalysis,
  type ComposerIntent,
  type IntentGuess,
  type MentionTrigger,
} from "./composer";
export {
  aggregateContribution,
  explainContribution,
  contributionStage,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_DEFAULTS,
  CONTRIBUTION_STAGES,
  NON_CONTRIBUTION_ACTIVITY,
  type ContributionEvent,
  type ContributionCategory,
  type ContributionStatus,
  type ContributionKindDef,
  type ContributionConfig,
  type ContributionScore,
  type ContributionFactor,
  type ContributionStage,
  type ContributionOptions,
} from "./contribution";
export {
  DOMAIN_LABEL,
  ENTITY_TYPES,
  RELATION_TYPES,
  entityTypeById,
  entityTypesByDomain,
  topicForEntityType,
  validateEntityProperties,
  createEntity,
  updateEntity,
  upsertProfile,
  activeRolesOf,
  hasRole,
  type OntologyDomain,
  type FieldType,
  type FieldDef,
  type EntityTypeDef,
  type RelationDef,
  // runtime registry (admin-defined multi-app ontology)
  BUILTIN_APP,
  appForEntityType,
  entityTypesForApp,
  relationsForApp,
  allApps,
  allEntityTypes,
  allRelations,
  appBySlug,
  getOntology,
  setCustomOntology,
  getCustomOntology,
  scopeToApp,
  type AppDef,
  type CustomOntology,
} from "./ontology";
