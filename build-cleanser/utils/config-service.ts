import axios from "axios";
import type { DomainsResponse } from "../types/domain.js";
import { Flow } from "@ondc/automation-mock-runner/dist/lib/types/flow-types.js";
export async function fetchDomains(): Promise<DomainsResponse> {
    const configServiceUrl = process.env.CONFIG_SERVICE_URL;
    const finalUrl = `${configServiceUrl}/ui/senario`;
    console.log("Fetching domains from config service at: ", finalUrl);
    const dataRes = await axios.get(finalUrl);
    const data = dataRes.data;
    return data;
}

export async function fetchFlow(
    domain: string,
    version: string,
    usecase: string,
): Promise<Flow[]> {
    const configServiceUrl = process.env.CONFIG_SERVICE_URL;
    const finalUrl = `${configServiceUrl}/ui/flow`;
    console.log("Fetching flow from config service at: ", finalUrl);
    const dataRes = await axios.get(finalUrl, {
        params: {
            domain,
            version,
            usecase,
        },
    });
    const data = dataRes.data;
    // console.log(
    //     "Fetched flow from config service: ",
    //     JSON.stringify(data, null, 2),
    // );
    return data.data.flows;
}

export async function fetchSupportedActionsForDomainVersion(
    domain: string,
    version: string,
): Promise<any> {
    const configServiceUrl = process.env.CONFIG_SERVICE_URL;
    const finalUrl = `${configServiceUrl}/api-service/supportedActions`;
    console.log(
        `Fetching supported actions for domain "${domain}", version "${version}" from config service at: ${finalUrl}`,
    );
    const dataRes = await axios.get(finalUrl, {
        params: {
            domain,
            version,
        },
    });
    const data = dataRes.data;
    console.log(
        `Fetched supported actions for domain "${domain}", version "${version}": `,
    );
    return data.data;
}
