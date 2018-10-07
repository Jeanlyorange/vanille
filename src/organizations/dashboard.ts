import { autoinject } from "aurelia-framework";
import { DaoService, VanilleDAO } from "../services/DaoService";
import { TokenService } from "../services/TokenService";
import { ArcService, WrapperService, Hash } from "../services/ArcService";
import { SchemeService, SchemeInfo } from "../services/SchemeService";
import { AureliaHelperService } from "../services/AureliaHelperService";
import { App } from '../app';
import { BigNumber, Web3Service } from '../services/Web3Service';
import { EventAggregator } from 'aurelia-event-aggregator';
import { EventConfigFailure } from '../entities/GeneralEvents';
import { SchemeDashboardModel } from 'schemeDashboards/schemeDashboardModel';
import { SchemePermissionsSelector } from 'resources/customElements/schemePermissions/schemePermissions';

@autoinject
export class DAODashboard {

  private org: VanilleDAO;
  private address: string;
  private orgName: string;
  private tokenSymbol: string;
  private daoTokenbalance: BigNumber;
  private daoEthbalance: BigNumber;
  private daoGenbalance: BigNumber;
  private registeredArcSchemes: Array<SchemeInfo>;
  private unregisteredArcSchemes: Array<SchemeInfo>;
  private nonArcSchemes: Array<SchemeInfo>;
  private arcSchemes: Array<SchemeInfo>;
  private subscription;
  private omega;
  private userReputation;
  private userNativeTokens;
  private dataLoaded: boolean = false;
  private dashboardElement: any;

  constructor(
    private daoService: DaoService
    , private tokenService: TokenService
    , private arcService: ArcService
    , private schemeService: SchemeService
    , private aureliaHelperService: AureliaHelperService
    , private web3Service: Web3Service
    , private eventAggregator: EventAggregator
  ) {
  }

  async activate(options: any) {

    this.address = options.address;
    this.org = await this.daoService.daoAt(this.address);
    if (this.org) {
      this.orgName = this.org.name;
      let token = this.org.token;
      this.tokenSymbol = await this.tokenService.getTokenSymbol(token);
      // in Wei
      this.daoTokenbalance = await this.tokenService.getTokenBalance(token, this.org.address);
      this.daoEthbalance = await this.web3Service.getBalance(this.org.address);
      try {
        const genToken = await this.tokenService.getGlobalGenToken();
        this.daoGenbalance = await this.tokenService.getTokenBalance(genToken, this.org.address);
      } catch (ex) {
        this.daoGenbalance = new BigNumber(0);
      }

      // in Wei
      this.omega = this.org.omega;
      this.userReputation = await this.org.reputation.getBalanceOf(this.web3Service.defaultAccount);
      this.userNativeTokens = await token.getBalanceOf(this.web3Service.defaultAccount);

      this.subscription = this.org.subscribe(VanilleDAO.daoSchemeSetChangedEvent, this.handleSchemeSetChanged.bind(this));
    } else {
      // don't force the user to see this as a snack every time.  A corrupt DAO may never be repaired.  A message will go to the console.
      // this.eventAggregator.publish("handleException", new EventConfigException(`Error loading DAO: ${avatarAddress}`, ex));
      this.eventAggregator.publish("handleFailure",
        new EventConfigFailure(`Error loading DAO: ${this.address}`));
    }
    this.dataLoaded = true;
    return Promise.resolve();
  }

  deactivate() {
    if (this.subscription) {
      this.subscription.dispose();
      this.subscription = null;
    }
  }

  attached() {

    const dashboard = $(this.dashboardElement);

    /**
     * css will reference the 'selected' class
     */
    dashboard.on('show.bs.collapse', '.scheme-dashboard', function (e: Event) {
      // ignore bubbles from nested collapsables
      if (!$(this).is(<any>e.target)) return;

      const button = $(e.target);
      const li = button.closest('li');
      li.addClass("selected");
    });

    dashboard.on('hide.bs.collapse', '.scheme-dashboard', function (e: Event) {
      // ignore bubbles from nested collapsables
      if (!$(this).is(<any>e.target)) return;

      const button = $(e.target);
      const li = button.closest('li');
      li.removeClass("selected");
    });

    return this.loadSchemes();
  }

  async loadSchemes() {
    /**
     * Get all schemes associated with the DAO.  These can include non-Arc schemes.
     */
    let schemes = await this.schemeService.getSchemesForDao(this.address);

    // add a fake non-Arc scheme
    // schemes.push(<SchemeInfo>{ address: "0x9ac0d209653719c86420bfca5d31d3e695f0b530" });

    const nonArcSchemes = Array.from(schemes).filter((s: SchemeInfo) => !s.inArc);

    for (let i = 0; i < nonArcSchemes.length; ++i) {
      const scheme = nonArcSchemes[i];
      const foundScheme = await this.findNonDeployedArcScheme(scheme);
      if (foundScheme) {
        schemes[schemes.indexOf(scheme)] = foundScheme;
      }
    }

    this.registeredArcSchemes = Array.from(schemes).filter((s: SchemeInfo) => s.inArc && s.inDao);
    this.unregisteredArcSchemes = Array.from(schemes).filter((s: SchemeInfo) => s.inArc && !s.inDao);
    this.nonArcSchemes = Array.from(schemes).filter((s: SchemeInfo) => !s.inArc);
    this.arcSchemes = Array.from(schemes).filter((s: SchemeInfo) => s.inArc);

    /**
     * Go through the nonArcSchemes and see whether we can identify any of them.
     * 
     * Selecting from WrapperService.nonUniversalSchemeFactories, get the contract 
     */

    // const factory = WrapperService.nonUniversalSchemeFactories.LockingEth4Reputation;

    this.polishDom();

    return Promise.resolve();
  }

  private async findNonDeployedArcScheme(scheme: SchemeInfo): Promise<SchemeInfo | null> {
    for (const wrapperName in WrapperService.nonUniversalSchemeFactories) {
      const factory = WrapperService.nonUniversalSchemeFactories[wrapperName];
      if (factory) {
        const contract = await factory.ensureSolidityContract();
        const code = await (<any>Promise).promisify((callback: any): any =>
          this.web3Service.web3.eth.getCode(scheme.address, callback))();
        const found = code === contract.deployedBinary;
        if (found) {
          const wrapper = await factory.at(scheme.address);
          return SchemeInfo.fromContractWrapper(wrapper, true);
        }
      }
    }
    return null;
  }

  private polishDom() {

    setTimeout(() => {
      //   ($(".scheme-use-button") as any).tooltip({
      //     toggle:"tooltip",
      //     placement:"top",
      //     trigger:"hover",
      //     title:"Click to work with this scheme"
      //   });
    }, 0);
  }

  private async handleSchemeSetChanged(params: { dao: VanilleDAO, scheme: SchemeInfo }) {
    let schemeInfo = params.scheme;
    let addTo: Array<SchemeInfo>;
    let removeFrom: Array<SchemeInfo>;

    if (!schemeInfo.inArc) {
      const foundScheme = await this.findNonDeployedArcScheme(schemeInfo);
      if (foundScheme) {
        schemeInfo = foundScheme;
      }
    }

    if (schemeInfo.inDao) { // adding
      if (schemeInfo.inArc) {
        addTo = this.registeredArcSchemes;
        removeFrom = this.unregisteredArcSchemes;
      } else { // adding non-Arc scheme to the DAO, not actually possible yet, but for completeness...
        addTo = this.nonArcSchemes;
      }
    }
    else { // removing
      if (schemeInfo.inArc) {
        addTo = this.unregisteredArcSchemes;
        removeFrom = this.registeredArcSchemes;
      } else {
        removeFrom = this.nonArcSchemes;
      }
    }

    if (removeFrom) {
      let index = this.getSchemeIndexFromAddress(schemeInfo.address, removeFrom);
      if (index !== -1) // shouldn't ever be -1
      {
        // in case we're re-adding below, lets move the existing schemeInfo instance, in case that helps retain any information
        removeFrom.splice(index, 1)[0];
      }
    }

    if (addTo) {
      let index = this.getSchemeIndexFromAddress(schemeInfo.address, addTo); // should always be -1
      if (index === -1) {
        addTo.push(schemeInfo);
      }
    }

    this.polishDom();
  }

  getDashboardView(scheme: SchemeInfo): string {
    let name: string;
    let isArcScheme = false;
    if (!scheme.inArc) {
      name = "NonArc";
    } else if (!scheme.inDao) {
      name = "NotRegistered";
    } else {
      name = scheme.name;
      isArcScheme = true;
    }

    if (isArcScheme && !App.hasDashboard(name)) {
      name = "UnknownArc";
    }
    return `../schemeDashboards/${name}`;
  }

  schemeDashboardViewModel(scheme: SchemeInfo): SchemeDashboardModel {
    return Object.assign({}, {
      org: this.org,
      orgName: this.orgName,
      orgAddress: this.address,
      tokenSymbol: this.tokenSymbol,
      allSchemes: this.arcSchemes
    },
      scheme)
  }

  getSchemeIndexFromAddress(address: string, collection: Array<SchemeInfo>): number {
    let result = collection.filter((s) => s.address === address);
    if (result.length > 1) {
      throw new Error("getSchemeInfoWithAddress: More than one schemes found");
    }
    return result.length ? collection.indexOf(result[0]) : -1;
  }
}
