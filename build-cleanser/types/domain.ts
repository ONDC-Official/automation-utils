export type DomainVersion = {
    key: string;
    usecase: string[];
};

export type Domain = {
    key: string;
    version: DomainVersion[];
};

export type DomainsResponse = {
    domain: Domain[];
};
