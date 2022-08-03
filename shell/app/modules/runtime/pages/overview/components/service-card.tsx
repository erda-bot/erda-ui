// Copyright (c) 2021 Terminus, Inc.
//
// This program is free software: you can use, redistribute, and/or modify
// it under the terms of the GNU Affero General Public License, version 3
// or later ("AGPL"), as published by the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

import React from 'react';
import { Tooltip, Popover, Tabs } from 'antd';
import { Icon as CustomIcon, IF, NoAuthTip } from 'common';
import { useUpdate } from 'common/use-hooks';
import HealthPoint from 'project/common/components/health-point';
import { map, isEmpty } from 'lodash';
import classNames from 'classnames';
import InstanceTable from 'runtime/common/components/instance-table';
import PodTable from 'runtime/common/components/pod-table';
import { SlidePanel, IWithTabs } from 'runtime/common/components/slide-panel-tabs';
import ProjectUnitDetail from 'monitor-common/components/resource-usage/resource-usage-charts';
import ContainerLog from 'runtime/common/logs/containers/container-log';
import Terminal from 'dcos/common/containers/terminal';
import i18n from 'i18n';
import { allWordsFirstLetterUpper, firstCharToUpper, notify, updateSearch } from 'common/utils';
import DomainModal from './domain-modal';
import ServiceDropdown from './service-dropdown';
import routeInfoStore from 'core/stores/route';
import './service-card.scss';
import { useMount } from 'react-use';
import runtimeStore from 'runtime/stores/runtime';
import { usePerm } from 'user/common';
import runtimeServiceStore from 'runtime/stores/service';
import runtimeDomainStore from 'runtime/stores/domain';
import ElasticScaling from './elastic-scaling';

const { TabPane } = Tabs;

const FORBIDDEN_STATUS_LIST = ['WAITING', 'DEPLOYING', 'CANCELING'];

const titleMap = {
  monitor: i18n.t('Container Monitoring'),
  log: i18n.t('runtime:Container log'),
  terminal: i18n.t('Console'),
  record: i18n.t('runtime:History'),
};

interface IProps {
  name: string;
  params: Obj;
  runtimeDetail: typeof runtimeStore.stateType.runtimeDetail;
  service: RUNTIME_SERVICE.Detail;
  isEndpoint?: boolean;
  runtimeType?: string;
}

const ServiceCard = (props: IProps) => {
  const {
    runtimeDetail,
    name,
    params: { appId, runtimeId },
    service,
    isEndpoint = false,
    runtimeType = 'service',
  } = props;

  const [serviceInsMap] = runtimeServiceStore.useStore((s) => [s.serviceInsMap]);
  const domainMap = runtimeDomainStore.useStore((s) => s.domainMap);
  const permMap = usePerm((s) => s.app);
  const [
    {
      title,
      visible,
      instances,
      withTabs,
      content,
      slideVisible,
      isFetching,
      domainModalVisible,
      elasticScalingVisible,
    },
    updater,
  ] = useUpdate({
    title: '',
    isFetching: false,
    visible: false,
    slideVisible: false,
    withTabs: {},
    content: null,
    instances: {},
    domainModalVisible: false,
    elasticScalingVisible: false,
  });

  React.useEffect(() => {
    if (serviceInsMap[name] !== undefined && serviceInsMap[name] !== instances) {
      updater.instances(serviceInsMap[name]);
    }
  }, [serviceInsMap, name, updater, instances]);

  const { serviceName, jumpFrom } = routeInfoStore.useStore((s) => s.query);

  const openSlidePanel = (type: string, record?: RUNTIME_SERVICE.Instance) => {
    updater.title(titleMap[type]);
    if (isEmpty(instances)) {
      runtimeServiceStore.getServiceInstances(name).then((data: RUNTIME_SERVICE.InsMap) => {
        renderSlidePanel(type, data, record);
      });
    } else {
      renderSlidePanel(type, instances as any, record);
    }
  };

  const renderSlidePanel = (type: string, insMap: RUNTIME_SERVICE.InsMap, record?: RUNTIME_SERVICE.Instance) => {
    let instanceList: RUNTIME_SERVICE.Instance[] = [];
    let defaultKey = '';

    const getTabKey = (ins: any) => {
      let tagId = '';
      const { id, containerId } = ins;
      if (containerId) {
        tagId = containerId.slice(0, 6);
      } else if (id) {
        // 兼容id有时候为containerId(k8s集群)
        tagId = id.includes('.') ? id.split('.')[1].slice(0, 6) : id.slice(0, 6);
      }
      return {
        tab: `${name} . ${tagId}`,
        key: ins.id || ins.containerId,
      };
    };

    const { runs = [] } = insMap;
    const getDefaultKey = (ins: RUNTIME_SERVICE.Instance) => {
      const { id, containerId } = ins;
      let key: any = id || containerId;
      type === 'monitor' && (key = containerId || id);
      return key;
    };

    // 没有 record，操作入口为 serviceCard 下拉，默认定位到运行中的第一个实例
    if (!record) {
      const firstIns = runs.length ? runs[0] : null;
      instanceList = runs;
      if (firstIns) {
        defaultKey = getDefaultKey(firstIns);
      }
    } else {
      // 有 record，操作入口为 instanceTable 或实例错误信息
      const { isRunning } = record;
      if (isRunning) {
        instanceList = runs;
      } else {
        instanceList = [record];
      }
      defaultKey = getDefaultKey(record);
    }

    switch (type) {
      // 优先取 containerId 查询，若无则用 id(instanceId) 查询
      case 'monitor': {
        const contents = map(instanceList, (ins) => {
          const { containerId, id } = ins;
          return {
            Comp: ProjectUnitDetail,
            props: {
              instance: ins,
              api: '/api/runtime/metrics',
              extraQuery: { filter_runtime_id: runtimeId, filter_application_id: appId },
            },
            ...getTabKey(ins),
            key: containerId || id,
          };
        });
        updater.withTabs({ defaultActiveKey: defaultKey, contents });
        break;
      }
      // id 和 containerId 中任意一个
      case 'log': {
        const contents = map(instanceList, (ins) => {
          const { isRunning } = ins;
          return {
            Comp: ContainerLog,
            props: {
              instance: ins,
              isStopped: !isRunning,
              extraQuery: { applicationId: appId },
              fetchApi: '/api/runtime/logs',
            },
            ...getTabKey(ins),
          };
        });
        updater.withTabs({ defaultActiveKey: defaultKey, contents });
        break;
      }
      case 'terminal': {
        const { clusterName } = runtimeDetail;
        const contents = map(instanceList, (ins) => {
          const { host, containerId, id } = ins;
          return {
            Comp: Terminal,
            props: {
              instanceTerminal: true,
              instance: ins,
              clusterName,
              host,
              containerId: containerId || id,
            },
            ...getTabKey(ins),
          };
        });
        updater.withTabs({ defaultActiveKey: defaultKey, contents });
        break;
      }
      case 'record': {
        updater.withTabs({});
        updater.content(<InstanceTable instances={insMap} withHeader={false} />);
        break;
      }
      default:
        break;
    }
    updater.slideVisible(true);
  };

  const togglePanel = () => {
    updater.visible(!visible);
    if (serviceInsMap[name] !== undefined) return;
    // 这里维护一个 isFetching 是因为如果通过 dva-loading 判断，在多个服务存在，展开另一个时原本的已展开的也会转菊花
    updater.isFetching(true);
    runtimeServiceStore.getServiceInstances(name).then(() => updater.isFetching(false));
  };

  useMount(() => {
    if (serviceName === name) {
      jumpFrom === 'ipPage' && togglePanel();
      jumpFrom === 'domainPage' && updater.domainModalVisible(true);
    }
  });

  const updateServicesConfig = (data: RUNTIME_SERVICE.PreOverlay) => {
    runtimeServiceStore.updateServicesConfig(data).then(() => {
      runtimeStore.getRuntimeDetail({ runtimeId, forceUpdate: true });
    });
  };

  const {
    resources,
    status,
    deployments: { replicas },
    errors,
  } = service as RUNTIME_SERVICE.Detail;

  const { cpu, mem } = resources;
  const expose = map(domainMap[name], 'domain').filter((domain) => !!domain);
  const isServiceType = runtimeType !== 'job';
  const resourceInfo = (
    <span className="resources nowrap">{`${
      isServiceType ? `${i18n.t('instance')} ${replicas} /` : ''
    } CPU ${cpu} / ${i18n.t('memory')} ${mem}MB`}</span>
  );

  const serviceClass = classNames({
    'service-card-wrapper': true,
    block: visible,
  });

  const getOperation = () => {
    const commonOps = (
      <div className="common-ops">
        <span>
          <ServiceDropdown
            openSlidePanel={openSlidePanel}
            openDomainModalVisible={() => updater.domainModalVisible(true)}
            service={service}
            isEndpoint={isEndpoint}
            updateServicesConfig={updateServicesConfig}
            name={name}
            deployStatus={runtimeDetail.deployStatus}
            onElasticScaling={() => {
              updater.elasticScalingVisible(true);
            }}
          />
          <DomainModal
            visible={domainModalVisible}
            onCancel={() => {
              updater.domainModalVisible(false);
              updateSearch({ serviceName: undefined, jumpFrom: undefined });
            }}
            serviceName={name}
          />
          <ElasticScaling
            visible={elasticScalingVisible}
            onClose={() => {
              updater.elasticScalingVisible(false);
              runtimeStore.getRuntimeDetail({ runtimeId, forceUpdate: true });
            }}
            serviceName={name}
          />
        </span>
      </div>
    );

    if (!isEndpoint) return commonOps;

    const hasCustomDomain = expose && expose.length > 0;
    const isOpsForbidden = FORBIDDEN_STATUS_LIST.includes(runtimeDetail.deployStatus);

    let links =
      expose && expose[0] ? (
        <a className="mr-3" href={`//${expose[0]}`} target="_blank" rel="noopener noreferrer">
          {i18n.t('runtime:Access Domain')}
        </a>
      ) : (
        <span
          className="domain-links hover-active"
          onClick={(e) => {
            e.stopPropagation();
            if (isOpsForbidden) {
              notify('warning', i18n.t('runtime:deploying, please operate later'));
            } else if (runtimeDetail.deployStatus !== 'OK' && isEmpty(domainMap)) {
              notify('warning', i18n.t('runtime:please operate after successful deployment'));
            } else {
              updater.domainModalVisible(true);
            }
          }}
        >
          {i18n.t('runtime:set domain')}
        </span>
      );

    if (expose && expose.length > 1) {
      const linkContent = (
        <ul className="popover-links">
          {map(expose, (link) => (
            <li key={link}>
              <a href={`//${link}`} target="_blank" rel="noopener noreferrer">
                {link}
              </a>
            </li>
          ))}
        </ul>
      );
      links = (
        <Popover title={i18n.t('runtime:available domain')} content={linkContent}>
          <span className="domain-links hover-active">{i18n.t('runtime:Access Domain')}</span>
        </Popover>
      );
    }
    return (
      <div className="endpoint-ops">
        {hasCustomDomain ? null : (
          <>
            <CustomIcon className="warning-info" type="tishi" />
            <span className="warning-info mr-3">{i18n.t('runtime:domain not set')}</span>
          </>
        )}
        {links}
        {commonOps}
      </div>
    );
  };
  const opsCol = {
    title: i18n.t('Operations'),
    width: 240,
    key: 'Operations',
    fixed: 'right',
    render: (record: RUNTIME_SERVICE.Instance) => {
      const { isRunning } = record;
      return (
        <div className="service-ops table-operations">
          <IF check={isRunning}>
            <IF check={(permMap.runtime[`${runtimeDetail.extra.workspace.toLowerCase()}Console`] || {}).pass}>
              <span className="table-operations-btn" onClick={() => openSlidePanel('terminal', { ...record })}>
                {i18n.t('Console')}
              </span>
              <IF.ELSE />

              <NoAuthTip>
                <span className="table-operations-btn">{i18n.t('Console')}</span>
              </NoAuthTip>
            </IF>
          </IF>
          <IF check={isServiceType}>
            <span className="table-operations-btn" onClick={() => openSlidePanel('monitor', { ...record })}>
              {i18n.t('Container Monitoring')}
            </span>
          </IF>
          <span className="table-operations-btn" onClick={() => openSlidePanel('log', { ...record })}>
            {firstCharToUpper(i18n.t('log'))}
          </span>
        </div>
      );
    },
  };

  let errorMsg: React.ReactNode = '';
  if (errors && errors[0] && status !== 'Healthy') {
    const { ctx, msg } = errors[0];
    const { instanceId } = ctx;
    const wrapTooltip = (children: any, text: string) => {
      return <Tooltip title={text}>{children}</Tooltip>;
    };
    const msgContent = `${msg}，${i18n.t('runtime:please view container log')}`;
    errorMsg = (
      <span
        className="log-link"
        onClick={(e) => {
          e.stopPropagation();
          openSlidePanel('log', { id: instanceId });
        }}
      >
        {msgContent}
      </span>
    );
    if (msg.length > 30) {
      errorMsg = wrapTooltip(errorMsg, msgContent);
    }
  }

  return (
    <React.Fragment>
      <div className={`${serviceClass} mb-5`}>
        <div className="service-card" onClick={() => togglePanel()}>
          <div className="service-card-icon-wrapper">
            <CustomIcon type={isEndpoint ? 'mysql1' : 'wfw1'} color />
          </div>
          <div className="service-card-info">
            <div className="info-msg">
              <IF check={status !== 'Healthy'}>
                <HealthPoint type="service" status={status} />
              </IF>
              <span className="name text-base">{name}</span>
              {resourceInfo}
              {runtimeDetail.services[name].hpaEnabled === 'Y' && (
                <span className="mr-4">{i18n.s('Elastic scaling policy is enabled', 'dop')}</span>
              )}
            </div>
            <div className="error-msg text-xs nowrap">{errorMsg}</div>
          </div>
          {isServiceType && (
            <div className="service-card-operation" onClick={(e) => e.stopPropagation()}>
              {getOperation()}
            </div>
          )}
        </div>
        <div className="inner-content">
          <Tabs defaultActiveKey="service-details">
            <TabPane
              tab={
                isServiceType
                  ? allWordsFirstLetterUpper(i18n.t('runtime:service details'))
                  : i18n.t('runtime:Task Details')
              }
              key="service-details"
            >
              <InstanceTable isFetching={isFetching} instances={instances} opsCol={opsCol} runtimeType={runtimeType} />
            </TabPane>
            <TabPane tab={i18n.t('Pod Details')} key="pod-detail">
              <PodTable runtimeID={runtimeId} service={name} />
            </TabPane>
          </Tabs>
        </div>
      </div>
      <SlidePanel
        title={title}
        content={content}
        withTabs={withTabs as IWithTabs}
        visible={slideVisible}
        closeSlidePanel={() => updater.slideVisible(false)}
      />
    </React.Fragment>
  );
};

export default ServiceCard;
