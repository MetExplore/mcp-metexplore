# CHANGELOG

## 0.1.1

- automatic publishing on npm

## 0.1.0

- `map_genes`: map a list of gene identifiers onto a network (mapped / not found / ambiguous report, pathway enrichment)

## 0.0.4

- fix map_metabolites: pathway ids and structured result

## 0.0.3

- Get names of the reactions

## 0.0.2

- Fix release ci

## 0.0.1

-   Features:
    -   `search_organisms`: search a network by name or db identifier, with disambiguation
    -   `search_metabolites`: search a metabolite by id, name, formula or cross-reference, with disambiguation
    -   `search_metabolites_by_formula`: list metabolites with a chemical formula (option to ignore hydrogens)
    -   `search_metabolites_by_external_id`: list metabolites cross-referenced to an external id (ChEBI, KEGG, HMDB, MetaNetX, PubChem, LipidMaps, InChI, BiGG, VMH...)
    -   `match_chebi`: match ChEBI ids through the ChEBI ontology (parents/children, conjugate acids/bases, tautomers, enantiomers)
    -   `count_reactions_for_metabolite`: count/list the reactions involving a metabolite
    -   `map_metabolites`: map a list of identifiers onto a network (mapped / not found / ambiguous report)
    -   `get_quota_status`: remaining API request quota for the session
-   Transports: stdio (local) and Streamable HTTP on `/mcp` with `GET /health`
-   Authentication: app key, optional user token or login/password (stdio), `X-MetExplore-Token` header (HTTP)
-   Per-session API request quota and in-memory cache
-   HTTP hardening: allowed hosts, trust proxy, per-IP rate limit, max sessions, session TTL
-   Dockerfile and GitLab CI (tests, build, deploy/stop on develop and production)
-   Unit tests (node:test, mocked fetch)
